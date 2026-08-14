import { type Api, type AssistantMessage, type Model, type Provider } from '@earendil-works/pi-ai'
import {
    BorderedLoader,
    SessionManager,
    buildSessionContext,
    convertToLlm,
    getAgentDir,
    serializeConversation,
    type ExtensionAPI,
    type ExtensionCommandContext,
    type ExtensionContext,
    type SessionHeader,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { createReadStream, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Path to the shared config file for this repo's custom extensions. */
const CONFIG_PATH = join(getAgentDir(), 'extensions.json')

/** Key for this extension's section in the shared config file. */
const CONFIG_KEY = 'handoff'

/** Default extension configuration. */
const DEFAULT_CONFIG = {
    model: 'openai-codex/gpt-5.6-luna',
    thinking: 'low' as const,
}

/** Supported thinking levels for handoff generation and session queries. */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Goal used when `/handoff` is run without arguments. */
const DEFAULT_GOAL =
    'Continue the current work. Infer the immediate next task from the conversation.'

/** System prompt for generating the handoff prompt. Adapted from Pi's canonical handoff example. */
const HANDOFF_SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history
and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key
   findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
4. Is self-contained - the new thread should be able to proceed without the old conversation

If the conversation produced a relevant plan, preserve it accurately. If the plan is already
stored in a file, reference its exact path instead of rewriting it. You may add a separate
"## Plan" section when relevant, but omit it entirely when there is no plan to carry over.

Format your response as a prompt the user can send to start the new thread. Be concise but
include all necessary context. Do not include any preamble like "Here's the prompt" - just
output the prompt itself.

Example output format:

## Context

We've been working on X. Key decisions:

- Decision 1
- Decision 2

Files involved:

- path/to/file1.ts
- path/to/file2.ts

## Task

[Clear description of what to do next based on user's goal]`

/** System prompt for answering a focused question about a parent or ancestor session. */
const SESSION_QUERY_SYSTEM_PROMPT = `You are answering a specific question about a prior Pi
coding-agent session on behalf of a fresh session that lacks this context. Using only the
provided session transcript:

- Prefer exact decisions, file paths, symbols, commands, errors, and outcomes over paraphrase.
- If the transcript does not contain the answer, say so explicitly instead of guessing.
- Be concise and do not continue or restart the old task; only answer the question asked.`

/** Hard cap on lineage traversal depth, guarding against malformed or cyclic session chains. */
const MAX_ANCESTORS = 50

/** Response-token cap for `session_query` so its tool result stays under Pi's output ceiling. */
const MAX_QUERY_RESPONSE_TOKENS = 4_000

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Thinking level used by the configured handoff model. */
type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** Extension configuration loaded from disk. */
type HandoffConfig = {
    model: string
    thinking: ThinkingLevel
}

/** Resolved model with auth info ready for direct provider calls. */
type ResolvedModel = {
    model: Model<Api>
    provider: Provider
    apiKey: string
    headers?: Record<string, string>
}

/** One entry in a session's parent/ancestor lineage, parent-first. */
type SessionReference = {
    relationship: 'parent' | 'ancestor'
    path: string
}

// -----------------------------------------------------------------------------
// Config functions
// -----------------------------------------------------------------------------

/** Read this extension's section from the shared config file, empty on errors. */
function readConfigFile(): Partial<HandoffConfig> {
    try {
        const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>
        const section = parsed[CONFIG_KEY]

        return section !== null && typeof section === 'object'
            ? (section as Partial<HandoffConfig>)
            : {}
    } catch {
        return {}
    }
}

/** Load extension config with defaults applied. */
function loadConfig(): HandoffConfig {
    const config = readConfigFile()

    return {
        model:
            typeof config.model === 'string' && config.model.trim()
                ? config.model.trim()
                : DEFAULT_CONFIG.model,
        thinking:
            config.thinking !== undefined && THINKING_LEVELS.includes(config.thinking)
                ? config.thinking
                : DEFAULT_CONFIG.thinking,
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Resolve and authenticate the configured handoff model. */
async function resolveModel(ctx: ExtensionContext, modelSpec: string): Promise<ResolvedModel> {
    const [providerId, ...rest] = modelSpec.split('/')
    const modelId = rest.join('/')
    const model = providerId && modelId ? ctx.modelRegistry.find(providerId, modelId) : undefined
    const provider = providerId ? ctx.modelRegistry.getProvider(providerId) : undefined

    if (!model || !provider) {
        throw new Error('Could not resolve the handoff model')
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model)

    if (!auth.ok || !auth.apiKey) {
        throw new Error('Could not authenticate the handoff model')
    }

    return { model, provider, apiKey: auth.apiKey, headers: auth.headers }
}

/** Extract and join text content blocks from an assistant response. */
function extractResponseText(response: AssistantMessage): string {
    return response.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim()
}

/**
 * Run one non-streaming completion call and return the final assistant response.
 *
 * Throws with the provider's actual error message when `stopReason === 'error'`, so callers never
 * have to invent a generic failure message for a real provider error. Aborted responses are
 * returned as-is; callers distinguish cancellation via `stopReason === 'aborted'`.
 */
async function complete(
    resolved: ResolvedModel,
    systemPrompt: string,
    userText: string,
    thinking: ThinkingLevel,
    signal: AbortSignal | undefined,
    maxTokens?: number,
): Promise<AssistantMessage> {
    const response = await resolved.provider
        .streamSimple(
            resolved.model,
            {
                systemPrompt,
                messages: [
                    {
                        role: 'user' as const,
                        content: [{ type: 'text' as const, text: userText }],
                        timestamp: Date.now(),
                    },
                ],
            },
            {
                apiKey: resolved.apiKey,
                headers: resolved.headers,
                maxTokens,
                reasoning: resolved.model.reasoning && thinking !== 'off' ? thinking : undefined,
                signal,
            },
        )
        .result()

    if (response.stopReason === 'error') {
        throw new Error(response.errorMessage || 'The model provider returned an error')
    }

    return response
}

/** Serialize a session's active, compaction-aware context, or null when it has no messages. */
function serializeSessionEntries(
    session: Pick<SessionManager, 'getEntries' | 'getLeafId'>,
): string | null {
    const { messages } = buildSessionContext(session.getEntries(), session.getLeafId())

    if (messages.length === 0) {
        return null
    }

    return serializeConversation(convertToLlm(messages))
}

/** Serialize the current session's active, compaction-aware context for handoff generation. */
function serializeActiveContext(ctx: ExtensionContext): string | null {
    return serializeSessionEntries(ctx.sessionManager)
}

/** Return true for a parsed JSONL value that looks like a Pi session header. */
function isSessionHeader(value: unknown): value is SessionHeader {
    return (
        typeof value === 'object' &&
        value !== null &&
        (value as { type?: unknown }).type === 'session' &&
        typeof (value as { id?: unknown }).id === 'string'
    )
}

/**
 * Read only the first JSONL line of a session file and parse it as a header.
 * Returns null for missing, unreadable, malformed, or non-session files.
 */
async function readSessionHeader(sessionPath: string): Promise<SessionHeader | null> {
    let stream: ReturnType<typeof createReadStream> | undefined
    let lines: ReturnType<typeof createInterface> | undefined

    try {
        stream = createReadStream(sessionPath, { encoding: 'utf8' })
        lines = createInterface({ input: stream, crlfDelay: Infinity })

        for await (const line of lines) {
            if (!line.trim()) {
                continue
            }

            const parsed: unknown = JSON.parse(line)
            return isSessionHeader(parsed) ? parsed : null
        }

        return null
    } catch {
        return null
    } finally {
        lines?.close()
        stream?.close()
    }
}

/**
 * Walk a session's parent lineage starting at `firstParentPath`, bounded and cycle-safe.
 *
 * The first path is tagged `parent`; every path reached afterward via `parentSession` is
 * tagged `ancestor`. A reference is kept even if its file can no longer be opened, since the
 * path is still known-good lineage metadata; traversal simply stops there. Reused both to
 * build the `/handoff` reference block and to authorize `session_query` lookups.
 */
async function collectSessionReferences(
    firstParentPath: string | undefined,
): Promise<SessionReference[]> {
    if (!firstParentPath) {
        return []
    }

    const references: SessionReference[] = []
    const seen = new Set<string>()
    let currentPath: string | undefined = firstParentPath

    while (currentPath && references.length < MAX_ANCESTORS) {
        const normalized = resolve(currentPath)

        if (seen.has(normalized)) {
            break
        }

        seen.add(normalized)
        references.push({
            relationship: references.length === 0 ? 'parent' : 'ancestor',
            path: currentPath,
        })

        const header = await readSessionHeader(currentPath)
        currentPath = header?.parentSession
    }

    return references
}

/**
 * Format `text` as a Markdown inline code span, choosing a backtick delimiter one character
 * longer than the longest backtick run inside `text`, with symmetric padding when the content
 * starts or ends with a backtick. This is the only way to keep the rendered code content an
 * exact match for `text` under CommonMark; naive backslash-escaping does not work inside code
 * spans.
 */
function formatCodeSpan(text: string): string {
    const runs = text.match(/`+/g) ?? []
    const maxRun = runs.reduce((max, run) => Math.max(max, run.length), 0)
    const fence = '`'.repeat(maxRun + 1)
    const needsPadding = text.startsWith('`') || text.endsWith('`')
    const content = needsPadding ? ` ${text} ` : text

    return `${fence}${content}${fence}`
}

/** Format the deterministic "Previous Sessions" block, or '' when there is no lineage. */
function formatSessionReferences(references: SessionReference[]): string {
    if (references.length === 0) {
        return ''
    }

    const [parent, ...ancestors] = references as [SessionReference, ...SessionReference[]]
    const lines = ['## Previous Sessions', '', `- Parent: ${formatCodeSpan(parent.path)}`]

    if (ancestors.length > 0) {
        lines.push('- Ancestors:')

        for (const ancestor of ancestors) {
            lines.push(`    - ${formatCodeSpan(ancestor.path)}`)
        }
    }

    lines.push(
        '',
        'Use `session_query` only if a detail needed for the task is missing from this handoff.',
    )

    return lines.join('\n')
}

// -----------------------------------------------------------------------------
// Main functions
// -----------------------------------------------------------------------------

/**
 * Generate a goal-directed handoff prompt from the active session context and place it,
 * unsubmitted, in a fresh child session's editor. Delegates from the thin `/handoff` handler.
 */
async function handleHandoff(args: string, ctx: ExtensionCommandContext): Promise<void> {
    if (ctx.mode !== 'tui') {
        ctx.ui.notify('Handoff requires the interactive TUI', 'error')
        return
    }

    const config = loadConfig()
    let resolved: ResolvedModel

    try {
        resolved = await resolveModel(ctx, config.model)
    } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
        return
    }

    const goal = args.trim() || DEFAULT_GOAL
    const conversationText = serializeActiveContext(ctx)

    if (!conversationText) {
        ctx.ui.notify('No conversation to hand off', 'error')
        return
    }

    const currentSessionFile = ctx.sessionManager.getSessionFile()
    const references = await collectSessionReferences(currentSessionFile)
    const userText = `## Conversation\n\n${conversationText}\n\n## Goal\n\n${goal}`

    const generated = await ctx.ui.custom<{ text: string } | { error: string } | null>(
        (tui, theme, _keybindings, done) => {
            const loader = new BorderedLoader(tui, theme, 'Generating handoff prompt...')
            loader.onAbort = () => done(null)

            complete(resolved, HANDOFF_SYSTEM_PROMPT, userText, config.thinking, loader.signal)
                .then((response) => {
                    if (response.stopReason === 'aborted') {
                        done(null)
                        return
                    }

                    const text = extractResponseText(response)
                    done(text ? { text } : { error: 'Empty response from the model' })
                })
                .catch((error) => {
                    done({ error: error instanceof Error ? error.message : String(error) })
                })

            return loader
        },
    )

    if (generated === null) {
        ctx.ui.notify('Handoff cancelled', 'info')
        return
    }

    if ('error' in generated) {
        ctx.ui.notify(`Handoff failed: ${generated.error}`, 'error')
        return
    }

    const referenceBlock = formatSessionReferences(references)
    const finalPrompt = referenceBlock ? `${generated.text}\n\n${referenceBlock}` : generated.text

    const result = await ctx.newSession({
        parentSession: currentSessionFile,
        withSession: async (replacementCtx) => {
            replacementCtx.ui.setEditorText(finalPrompt)
            replacementCtx.ui.notify('Handoff ready. Edit if needed, then submit.', 'info')
        },
    })

    if (result.cancelled) {
        ctx.ui.notify('New session cancelled', 'info')
    }
}

/**
 * Answer a focused question about a parent or ancestor session, rejecting any path outside the
 * current session's lineage before opening it.
 */
async function executeSessionQuery(
    ctx: ExtensionContext,
    params: { sessionPath: string; question: string },
    signal: AbortSignal | undefined,
) {
    const sessionPath = params.sessionPath.trim().replace(/^@/, '')
    const question = params.question.trim()

    if (!sessionPath || !question) {
        throw new Error('session_query requires a session path and question')
    }

    const header = ctx.sessionManager.getHeader()
    const allowed = await collectSessionReferences(header?.parentSession)

    if (allowed.length === 0) {
        throw new Error('The current session has no parent or ancestor sessions to query')
    }

    const normalizedTarget = resolve(sessionPath)
    const isAllowed = allowed.some((reference) => resolve(reference.path) === normalizedTarget)

    if (!isAllowed) {
        throw new Error('The requested session is not a parent or ancestor of the current session')
    }

    if (!(await readSessionHeader(sessionPath))) {
        throw new Error('Could not open the requested session')
    }

    let manager: SessionManager

    try {
        manager = SessionManager.open(sessionPath)
    } catch {
        throw new Error('Could not open the requested session')
    }

    const conversationText = serializeSessionEntries(manager)

    if (!conversationText) {
        throw new Error('The requested session contains no queryable context')
    }

    const config = loadConfig()
    const resolved = await resolveModel(ctx, config.model)
    const userText = `## Session\n\n${conversationText}\n\n## Question\n\n${question}`
    const response = await complete(
        resolved,
        SESSION_QUERY_SYSTEM_PROMPT,
        userText,
        config.thinking,
        signal,
        MAX_QUERY_RESPONSE_TOKENS,
    )

    if (response.stopReason === 'aborted') {
        throw new Error('session_query was cancelled')
    }

    const answer = extractResponseText(response)

    if (!answer) {
        throw new Error('Could not answer the question from the requested session')
    }

    return {
        content: [{ type: 'text' as const, text: answer }],
        details: { path: sessionPath, question },
        usage: response.usage,
    }
}

// -----------------------------------------------------------------------------
// Extension entry point
// -----------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
    pi.registerCommand('handoff', {
        description: 'Transfer context to a fresh session with an editable, goal-directed prompt',
        handler: async (args, ctx) => {
            await handleHandoff(args, ctx)
        },
    })

    pi.registerTool({
        name: 'session_query',
        label: 'Session Query',
        description:
            'Query a parent or ancestor Pi session for a specific detail missing from a ' +
            'handoff. Use only when the current handoff is missing something needed for the ' +
            'task, and ask a specific question.',
        parameters: Type.Object({
            sessionPath: Type.String({
                description: 'Exact parent or ancestor session path shown in the handoff',
            }),
            question: Type.String({
                description: 'Specific missing detail to retrieve from that session',
            }),
        }),
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            return executeSessionQuery(ctx, params, signal)
        },
    })
}
