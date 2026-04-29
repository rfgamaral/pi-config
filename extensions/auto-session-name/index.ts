import { complete, type Model, type Api } from '@mariozechner/pi-ai'
import {
    getAgentDir,
    type ExtensionAPI,
    type ExtensionContext,
    type SessionEntry,
} from '@mariozechner/pi-coding-agent'
import { convertToLlm, serializeConversation } from '@mariozechner/pi-coding-agent'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Path to the extension's global config file. */
const CONFIG_PATH = join(getAgentDir(), 'extensions', 'auto-session-name.json')

/** Default extension configuration. */
const DEFAULT_CONFIG = {
    model: 'openai-codex/gpt-5.4-mini',
    renameOnCompaction: 'on' as const,
}

/** Shared formatting rules appended to all naming prompts. */
const FORMAT_RULES =
    'Use sentence case: capitalize the first word, but keep the rest lowercase ' +
    'unless a word is a proper noun, product name, or acronym. ' +
    'Aim for 80-90 characters, but you may go up to 100 if needed to be descriptive. ' +
    'Return ONLY the title, nothing else. No quotes, no punctuation at the end, no prefixes.'

/** System prompt used to generate session names. */
const NAMING_PROMPT =
    'You are a session naming assistant. Given a conversation between a user and ' +
    'an AI coding agent, generate a short, descriptive title that captures the ' +
    'main topic or goal. ' +
    FORMAT_RULES

/** System prompt used when re-evaluating an existing session name. */
const RENAME_PROMPT =
    'You are a session naming assistant. Given a conversation between a user and ' +
    'an AI coding agent, and the current session title, decide whether the title ' +
    'still accurately reflects what the conversation is about. If it does, return ' +
    'the current title unchanged. If the conversation has shifted focus, return a ' +
    'new, descriptive title. ' +
    FORMAT_RULES

/** Maximum number of characters from the serialized conversation to send. */
const MAX_CONTEXT_LENGTH = 4_000

/** Custom entry type used to persist the last extension-set name. */
const ENTRY_TYPE = 'auto-session-name'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Extension configuration loaded from disk. */
type AutoSessionNameConfig = {
    model: string
    renameOnCompaction: 'on' | 'off'
}

/** Resolved model with auth info ready for API calls. */
type ResolvedModel = {
    model: Model<Api>
    apiKey: string
    headers?: Record<string, string>
}

/** In-memory auto-session-name extension state. */
type AutoSessionNameState = {
    named: boolean
    lastExtensionName?: string
}

// -----------------------------------------------------------------------------
// Config functions
// -----------------------------------------------------------------------------

/** Read the extension config file, returning an empty object on read or parse errors. */
function readConfigFile(): Partial<AutoSessionNameConfig> {
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<AutoSessionNameConfig>
    } catch {
        return {}
    }
}

/** Load extension config with defaults applied. */
function loadConfig(): AutoSessionNameConfig {
    const config = readConfigFile()

    return {
        ...DEFAULT_CONFIG,
        model:
            typeof config.model === 'string' && config.model ? config.model : DEFAULT_CONFIG.model,
        renameOnCompaction:
            config.renameOnCompaction === 'off' ? 'off' : DEFAULT_CONFIG.renameOnCompaction,
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Resolve and authenticate the configured model. Returns null if the model
 * is not found in the registry or has no valid API key.
 */
async function resolveModel(
    ctx: ExtensionContext,
    modelSpec: string,
): Promise<ResolvedModel | null> {
    const [provider, ...rest] = modelSpec.split('/')
    const modelId = rest.join('/')

    if (!provider || !modelId) {
        return null
    }

    const model = ctx.modelRegistry.find(provider, modelId)

    if (!model) {
        return null
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)

    if (!auth.ok || !auth.apiKey) {
        return null
    }

    return { model, apiKey: auth.apiKey, headers: auth.headers }
}

/**
 * Serialize the current session branch into a compact text representation,
 * truncated to stay within token budget.
 */
function serializeBranch(ctx: ExtensionContext): string {
    const branch = ctx.sessionManager.getBranch()

    const messages = branch
        .filter((entry): entry is SessionEntry & { type: 'message' } => entry.type === 'message')
        .map((entry) => entry.message)

    if (messages.length === 0) {
        return ''
    }

    const llmMessages = convertToLlm(messages)
    const full = serializeConversation(llmMessages)

    if (full.length <= MAX_CONTEXT_LENGTH) {
        return full
    }

    return full.slice(0, MAX_CONTEXT_LENGTH) + '\n[...truncated]'
}

// -----------------------------------------------------------------------------
// Main functions
// -----------------------------------------------------------------------------

/** Persist the extension-set name so we can detect manual renames after restart. */
function trackExtensionName(pi: ExtensionAPI, state: AutoSessionNameState, name: string): void {
    state.lastExtensionName = name
    pi.appendEntry(ENTRY_TYPE, { name })
}

/** Whether the session name was manually set by the user, outside this extension. */
function isManuallyNamed(pi: ExtensionAPI, state: AutoSessionNameState): boolean {
    const current = pi.getSessionName()
    return !!current && current !== state.lastExtensionName
}

/** Generate a session name from the current conversation. */
async function generateName(
    ctx: ExtensionContext,
    resolved: ResolvedModel,
    currentName?: string,
): Promise<string | null> {
    const conversation = serializeBranch(ctx)

    if (!conversation) {
        return null
    }

    let userPrompt = `<conversation>\n${conversation}\n</conversation>`

    if (currentName) {
        userPrompt += `\n\nCurrent session title: "${currentName}"`
    }

    const response = await complete(
        resolved.model,
        {
            systemPrompt: currentName ? RENAME_PROMPT : NAMING_PROMPT,
            messages: [
                {
                    role: 'user' as const,
                    content: [{ type: 'text' as const, text: userPrompt }],
                    timestamp: Date.now(),
                },
            ],
        },
        {
            apiKey: resolved.apiKey,
            headers: resolved.headers,
        },
    )

    const name = response.content
        .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
        .map((content) => content.text)
        .join('')
        .trim()
        .replace(/^["']|["']$/g, '')

    return name || null
}

/** Restore naming state from the current session. */
function handleSessionStart(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    state: AutoSessionNameState,
): void {
    state.named = !!pi.getSessionName()
    state.lastExtensionName = undefined

    let hasTrackingEntries = false

    for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type === 'custom' && entry.customType === ENTRY_TYPE) {
            state.lastExtensionName = (entry.data as { name?: string })?.name
            hasTrackingEntries = true
        }
    }

    if (!hasTrackingEntries) {
        state.lastExtensionName = pi.getSessionName() ?? undefined
    }
}

/** Set the initial session name after the first agent exchange. */
async function handleAgentEnd(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    state: AutoSessionNameState,
): Promise<void> {
    if (state.named) {
        return
    }

    state.named = true

    const config = loadConfig()
    const resolved = await resolveModel(ctx, config.model)

    if (!resolved) {
        state.named = false
        return
    }

    const name = await generateName(ctx, resolved)

    if (name) {
        pi.setSessionName(name)
        trackExtensionName(pi, state, name)
    } else {
        state.named = false
    }
}

/** Re-evaluate the session name on demand. */
async function handleRenameSessionName(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    state: AutoSessionNameState,
    args?: string,
): Promise<void> {
    const force = args?.trim() === '--force' || args?.trim() === '-f'

    if (isManuallyNamed(pi, state) && !force) {
        ctx.ui.notify('Session was manually named, use -f to override', 'warning')
        return
    }

    const config = loadConfig()
    const resolved = await resolveModel(ctx, config.model)

    if (!resolved) {
        ctx.ui.notify('Could not resolve naming model', 'error')
        return
    }

    const currentName = force ? undefined : (pi.getSessionName() ?? undefined)
    const name = await generateName(ctx, resolved, currentName)

    if (name) {
        const kept = currentName && name === currentName
        pi.setSessionName(name)
        trackExtensionName(pi, state, name)
        state.named = true
        ctx.ui.notify(`Session name ${kept ? 'kept' : 'updated'}: ${name}`, 'info')
    } else {
        ctx.ui.notify('Could not generate a name', 'error')
    }
}

/** Re-evaluate the session name after compaction, when enabled. */
async function handleSessionCompact(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    state: AutoSessionNameState,
): Promise<void> {
    const config = loadConfig()

    if (config.renameOnCompaction !== 'on' || !state.named || isManuallyNamed(pi, state)) {
        return
    }

    const resolved = await resolveModel(ctx, config.model)

    if (!resolved) {
        return
    }

    const currentName = pi.getSessionName()
    const name = await generateName(ctx, resolved, currentName ?? undefined)

    if (name) {
        pi.setSessionName(name)
        trackExtensionName(pi, state, name)
    }
}

/** Register the auto-session-name extension handlers. */
function registerAutoSessionNameExtension(pi: ExtensionAPI, state: AutoSessionNameState): void {
    pi.on('session_start', (_event, ctx) => {
        handleSessionStart(pi, ctx, state)
    })

    pi.on('agent_end', async (_event, ctx) => {
        await handleAgentEnd(pi, ctx, state)
    })

    pi.registerCommand('rename-session-name', {
        description: 'Re-evaluate the session name (use -f to override a manual name)',
        handler: async (args, ctx) => {
            await handleRenameSessionName(pi, ctx, state, args)
        },
    })

    pi.on('session_compact', async (_event, ctx) => {
        await handleSessionCompact(pi, ctx, state)
    })
}

// -----------------------------------------------------------------------------
// Extension entry point
// -----------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
    const state: AutoSessionNameState = { named: false }
    registerAutoSessionNameExtension(pi, state)
}
