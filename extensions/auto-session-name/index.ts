import { complete, type Model, type Api } from '@earendil-works/pi-ai'
import {
    buildSessionContext,
    getAgentDir,
    type ExtensionAPI,
    type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
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
    'dominant topic, goal, or conversation arc. ' +
    FORMAT_RULES

/** System prompt used when re-evaluating an existing session name. */
const RENAME_PROMPT =
    'You are a session naming assistant. Given a conversation between a user and ' +
    'an AI coding agent, and the current session title, decide whether the title ' +
    'still accurately reflects the dominant topic, goal, or conversation arc. ' +
    'Keep the current title only if it describes the whole conversation, not merely ' +
    'the opening request. If the conversation evolved into a new sustained focus, ' +
    'return a new, descriptive title. ' +
    FORMAT_RULES

/** System prompt used to summarize long conversation slices for naming. */
const NAMING_DIGEST_PROMPT =
    'You are preparing part of a longer coding-agent conversation for session naming. ' +
    'Summarize this chronological slice in concise bullets. Capture the goals, topic ' +
    'shifts, important decisions, and outcomes. Ignore tool noise and implementation ' +
    'minutiae unless they define the conversation topic. Do not suggest a title.'

/** Maximum number of characters to send to the final naming request. */
const MAX_CONTEXT_LENGTH = 16_000

/** Maximum number of characters to send in one digest summarization request. */
const MAX_DIGEST_CHUNK_LENGTH = 16_000

/** Maximum characters retained from a single message before chunking. */
const MAX_MESSAGE_LENGTH = 1_200

/** Maximum characters retained from compaction and branch summaries. */
const MAX_SUMMARY_LENGTH = 2_500

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

/** Return true for text content blocks. */
function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
    return (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
    )
}

/** Extract visible text content from string or block-array message content. */
function extractTextContent(content: unknown): string {
    if (typeof content === 'string') {
        return content
    }

    if (!Array.isArray(content)) {
        return ''
    }

    return content
        .filter(isTextBlock)
        .map((block) => block.text)
        .join('\n')
}

/** Strip terminal escape codes and normalize noisy whitespace for model prompts. */
function cleanText(text: string): string {
    return text
        .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/** Truncate long text while preserving both beginning and end. */
function truncateMiddle(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text
    }

    const marker = '\n[...omitted...]\n'
    const remaining = maxLength - marker.length
    const headLength = Math.ceil(remaining / 2)
    const tailLength = Math.floor(remaining / 2)

    return text.slice(0, headLength).trimEnd() + marker + text.slice(-tailLength).trimStart()
}

/** Format one message-like item for the naming digest. */
function formatDigestPart(
    label: string,
    text: string,
    maxLength = MAX_MESSAGE_LENGTH,
): string | null {
    const cleaned = cleanText(text)

    if (!cleaned) {
        return null
    }

    return `[${label}]: ${truncateMiddle(cleaned, maxLength)}`
}

/**
 * Serialize the current session branch into a compact naming digest.
 *
 * This uses the same compaction-aware context builder as agent prompts, then
 * strips tool results, thinking blocks, and tool calls so the naming model sees
 * the conversation arc instead of raw execution noise.
 */
function serializeBranchForNaming(ctx: ExtensionContext): string {
    const { messages } = buildSessionContext(
        ctx.sessionManager.getEntries(),
        ctx.sessionManager.getLeafId(),
    )
    const parts: string[] = []

    for (const message of messages) {
        if (message.role === 'user') {
            const part = formatDigestPart('User', extractTextContent(message.content))

            if (part) {
                parts.push(part)
            }
        } else if (message.role === 'assistant') {
            const part = formatDigestPart('Assistant', extractTextContent(message.content))

            if (part) {
                parts.push(part)
            }
        } else if (message.role === 'custom') {
            const part = formatDigestPart(
                `Context: ${message.customType}`,
                extractTextContent(message.content),
            )

            if (part) {
                parts.push(part)
            }
        } else if (message.role === 'branchSummary') {
            const part = formatDigestPart('Branch summary', message.summary, MAX_SUMMARY_LENGTH)

            if (part) {
                parts.push(part)
            }
        } else if (message.role === 'compactionSummary') {
            const part = formatDigestPart(
                'Earlier conversation summary',
                message.summary,
                MAX_SUMMARY_LENGTH,
            )

            if (part) {
                parts.push(part)
            }
        } else if (message.role === 'bashExecution' && !message.excludeFromContext) {
            const part = formatDigestPart('User shell command', message.command, 400)

            if (part) {
                parts.push(part)
            }
        }
    }

    return parts.join('\n\n')
}

/** Split a digest into message-bound chunks for summarization. */
function splitDigestIntoChunks(digest: string): string[] {
    const items = digest.split(/\n\n(?=\[[^\]]+\]: )/)
    const chunks: string[] = []
    let current = ''

    for (const item of items) {
        const nextItem =
            item.length > MAX_DIGEST_CHUNK_LENGTH
                ? truncateMiddle(item, MAX_DIGEST_CHUNK_LENGTH)
                : item

        if (current && current.length + nextItem.length + 2 > MAX_DIGEST_CHUNK_LENGTH) {
            chunks.push(current)
            current = nextItem
        } else {
            current = current ? `${current}\n\n${nextItem}` : nextItem
        }
    }

    if (current) {
        chunks.push(current)
    }

    return chunks
}

/** Extract text from an assistant response. */
function extractResponseText(response: Awaited<ReturnType<typeof complete>>): string {
    return response.content
        .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
        .map((content) => content.text)
        .join('')
        .trim()
        .replace(/^["']|["']$/g, '')
}

/** Summarize one long digest chunk for the final naming request. */
async function summarizeDigestChunk(
    resolved: ResolvedModel,
    chunk: string,
    index: number,
    total: number,
    maxSummaryLength: number,
    signal?: AbortSignal,
): Promise<string | null> {
    const response = await complete(
        resolved.model,
        {
            systemPrompt: NAMING_DIGEST_PROMPT,
            messages: [
                {
                    role: 'user' as const,
                    content: [
                        {
                            type: 'text' as const,
                            text:
                                `Conversation slice ${index + 1} of ${total}:\n\n` +
                                `<conversation-slice>\n${chunk}\n</conversation-slice>`,
                        },
                    ],
                    timestamp: Date.now(),
                },
            ],
        },
        {
            apiKey: resolved.apiKey,
            headers: resolved.headers,
            maxTokens: 800,
            signal,
        },
    )

    const summary = extractResponseText(response)

    return summary ? truncateMiddle(summary, maxSummaryLength) : null
}

/** Build the context sent to the final naming request. */
async function buildNamingContext(ctx: ExtensionContext, resolved: ResolvedModel): Promise<string> {
    const digest = serializeBranchForNaming(ctx)

    if (!digest || digest.length <= MAX_CONTEXT_LENGTH) {
        return digest
    }

    const chunks = splitDigestIntoChunks(digest)
    const maxSummaryLength = Math.max(
        500,
        Math.floor((MAX_CONTEXT_LENGTH - chunks.length * 80) / chunks.length),
    )
    const summaries: string[] = []

    for (let index = 0; index < chunks.length; index += 1) {
        const summary = await summarizeDigestChunk(
            resolved,
            chunks[index],
            index,
            chunks.length,
            maxSummaryLength,
            ctx.signal,
        )

        if (summary) {
            summaries.push(`[Conversation slice ${index + 1}/${chunks.length} summary]\n${summary}`)
        }
    }

    if (summaries.length === 0) {
        return truncateMiddle(digest, MAX_CONTEXT_LENGTH)
    }

    return truncateMiddle(summaries.join('\n\n'), MAX_CONTEXT_LENGTH)
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
    const conversation = await buildNamingContext(ctx, resolved)

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
            signal: ctx.signal,
        },
    )

    const name = extractResponseText(response)

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
