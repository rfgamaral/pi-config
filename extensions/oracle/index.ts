import {
    completeSimple,
    supportsXhigh,
    type UserMessage,
    type Model,
    type Api,
} from '@mariozechner/pi-ai'
import type { ExtensionAPI, ExtensionContext, SessionEntry } from '@mariozechner/pi-coding-agent'
import {
    convertToLlm,
    getAgentDir,
    keyHint,
    serializeConversation,
} from '@mariozechner/pi-coding-agent'
import {
    Text,
    matchesKey,
    truncateToWidth,
    visibleWidth,
    wrapTextWithAnsi,
} from '@mariozechner/pi-tui'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Path to the extension's global config file. */
const CONFIG_PATH = join(getAgentDir(), 'extensions', 'oracle.json')

/** Default extension configuration. */
const DEFAULT_CONFIG = {
    models: ['anthropic/claude-opus-4-7', 'openai-codex/gpt-5.5'],
    maxThinking: 'auto' as const,
}

/** Valid thinking levels for the oracle query. */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

/** Errors that indicate the provider rejected the requested thinking level. */
const THINKING_LEVEL_ERROR_PATTERNS = [
    /invalid[^\n]*reasoning(?:[-_ ]effort)?/i,
    /unsupported[^\n]*reasoning(?:[-_ ]effort)?/i,
    /reasoning(?:[-_ ]effort)?[^\n]*not supported/i,
    /invalid[^\n]*thinking/i,
    /unsupported[^\n]*thinking/i,
    /thinking[^\n]*not supported/i,
    /output_config[^\n]*effort/i,
]

/** Minimum number of visible body lines in the result view. */
const MIN_BODY_LINES = 10

/** Maximum number of visible body lines in the result view. */
const MAX_BODY_LINES = 30

/** Percentage of terminal height used for the result view body. */
const BODY_HEIGHT_PERCENT = 25

/** Per-session memory of the highest working thinking level discovered per model. */
const discoveredThinkingLevels = new Map<string, ThinkingLevel>()

/** System prompt sent with Oracle requests. */
const ORACLE_SYSTEM_PROMPT =
    'You are providing a second opinion on a coding conversation.\n' +
    'You have access to the full conversation context between the user and their ' +
    'primary AI assistant.\nYour job is to:\n' +
    "1. Understand what they've been discussing\n" +
    "2. Answer the specific question they're asking you\n" +
    '3. Point out if you disagree with any decisions made\n' +
    '4. Be concise but thorough\n\n' +
    'Focus on being helpful and providing a fresh perspective.'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Thinking level passed to the oracle model. */
type ThinkingLevel = (typeof THINKING_LEVELS)[number]

type ThinkingMode = 'auto' | 'explicit'

/** Extension configuration loaded from disk. */
type OracleConfig = {
    models: string[]
    maxThinking: 'auto' | ThinkingLevel
}

/** Model resolved from the ranked list with provider metadata. */
type AvailableModel = {
    provider: string
    modelId: string
    name: string
    model: Model<Api>
    apiKey?: string
    headers?: Record<string, string>
}

/** Style published by cockpit-panel via the `cockpit:style` event. */
type CockpitStyle = {
    borderColor: (s: string) => string
    textLight: (s: string) => string
    textLightBold: boolean
}

// -----------------------------------------------------------------------------
// Config functions
// -----------------------------------------------------------------------------

/** Read the extension config file, returning an empty object on read or parse errors. */
function readConfigFile(): Partial<OracleConfig> {
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Partial<OracleConfig>
    } catch {
        return {}
    }
}

/** Load extension config with defaults applied. */
function loadConfig(): OracleConfig {
    const config = readConfigFile()

    const models = Array.isArray(config.models)
        ? config.models.map((entry) => entry.trim()).filter(Boolean)
        : DEFAULT_CONFIG.models

    return {
        ...DEFAULT_CONFIG,
        models: models.length > 0 ? models : DEFAULT_CONFIG.models,
        maxThinking:
            config.maxThinking === 'auto' ||
            (config.maxThinking !== undefined && THINKING_LEVELS.includes(config.maxThinking))
                ? config.maxThinking
                : DEFAULT_CONFIG.maxThinking,
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function getAutoThinkingLevel(model: Pick<Model<Api>, 'api' | 'id' | 'reasoning'>): ThinkingLevel {
    if (!model.reasoning) {
        return 'off'
    }

    if (model.api === 'bedrock-converse-stream') {
        return 'high'
    }

    return supportsXhigh(model as Model<Api>) ? 'xhigh' : 'high'
}

function clampThinkingLevel(level: ThinkingLevel, cap: ThinkingLevel): ThinkingLevel {
    const levelIndex = THINKING_LEVELS.indexOf(level)
    const capIndex = THINKING_LEVELS.indexOf(cap)

    return levelIndex > capIndex ? cap : level
}

function nextLowerThinkingLevel(level: ThinkingLevel): ThinkingLevel | null {
    const index = THINKING_LEVELS.indexOf(level)

    return index > 0 ? THINKING_LEVELS[index - 1]! : null
}

function isRetryableThinkingLevelError(error: unknown, level: ThinkingLevel): boolean {
    const message = error instanceof Error ? error.message : String(error)
    const normalizedLevel = level.toLowerCase()
    const normalizedMessage = message.toLowerCase()

    if (!THINKING_LEVEL_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
        return false
    }

    return (
        normalizedMessage.includes(normalizedLevel) ||
        normalizedMessage.includes(`"${normalizedLevel}"`) ||
        normalizedMessage.includes(`'${normalizedLevel}'`) ||
        /\b(one of|must be|expected|allowed values?)\b/i.test(message)
    )
}

async function discoverSupportedThinkingLevel<T>({
    initialLevel,
    mode = 'auto',
    run,
}: {
    initialLevel: ThinkingLevel
    mode?: ThinkingMode
    run: (level: ThinkingLevel) => Promise<T>
}): Promise<{ level: ThinkingLevel; value: T }> {
    let level: ThinkingLevel | null = initialLevel
    let lastError: unknown = null

    while (level) {
        try {
            return { level, value: await run(level) }
        } catch (error) {
            lastError = error

            if (mode !== 'auto' || !isRetryableThinkingLevelError(error, level)) {
                throw error
            }

            level = nextLowerThinkingLevel(level)
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function getThinkingCacheKey(model: AvailableModel): string {
    return `${model.provider}/${model.modelId}`
}

function getInitialThinkingLevel(
    model: AvailableModel,
    maxThinking: OracleConfig['maxThinking'],
): ThinkingLevel {
    const cached = discoveredThinkingLevels.get(getThinkingCacheKey(model))

    if (cached) {
        return maxThinking === 'auto' ? cached : clampThinkingLevel(cached, maxThinking)
    }

    return maxThinking === 'auto' ? getAutoThinkingLevel(model.model) : maxThinking
}

class OracleAbortedError extends Error {
    constructor() {
        super('Oracle request cancelled')
        this.name = 'OracleAbortedError'
    }
}

/**
 * Walk the ranked model list and return the first available model that is not
 * the current session model. When `modelArg` is provided, only matching
 * entries are considered.
 */
function resolveModel(
    ctx: ExtensionContext,
    models: string[],
    modelArg?: string,
): AvailableModel | null {
    const candidates = models.map((entry) => {
        const [provider, ...rest] = entry.split('/')

        return { provider, modelId: rest.join('/') }
    })

    for (const candidate of candidates) {
        if (modelArg) {
            const matches =
                candidate.modelId === modelArg ||
                candidate.modelId.includes(modelArg) ||
                `${candidate.provider}/${candidate.modelId}`
                    .toLowerCase()
                    .includes(modelArg.toLowerCase())

            if (!matches) {
                continue
            }
        }

        const model = ctx.modelRegistry.find(candidate.provider, candidate.modelId)

        if (!model) {
            continue
        }

        if (!modelArg && ctx.model && model.id === ctx.model.id) {
            continue
        }

        return {
            provider: candidate.provider,
            modelId: candidate.modelId,
            name: `${candidate.provider}/${candidate.modelId}`,
            model,
        }
    }

    return null
}

/** Verify the resolved model has a valid API key and attach auth info. */
async function authenticateModel(
    ctx: ExtensionContext,
    resolved: AvailableModel,
): Promise<AvailableModel | null> {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(resolved.model)

    if (!auth.ok) {
        return null
    }

    return { ...resolved, apiKey: auth.apiKey, headers: auth.headers }
}

/**
 * Derive a brighter variant of a color function by lerping its RGB values
 * toward white. Returns the original function if RGB cannot be extracted.
 */
function brighten(colorFn: (s: string) => string, factor = 0.4): (s: string) => string {
    const sample = colorFn('X')
    const match = sample.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/)

    if (!match) {
        return colorFn
    }

    const [r, g, b] = [+match[1]!, +match[2]!, +match[3]!].map((c) =>
        Math.min(255, Math.round(c + (255 - c) * factor)),
    )

    return (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`
}

// -----------------------------------------------------------------------------
// Main functions
// -----------------------------------------------------------------------------

async function executeOracle(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    prompt: string,
    files: string[],
    model: AvailableModel,
    initialThinkingLevel: ThinkingLevel,
    thinkingMode: ThinkingMode,
    cockpitStyle: CockpitStyle | null,
): Promise<void> {
    const branch = ctx.sessionManager.getBranch()

    const messages = branch
        .filter((entry): entry is SessionEntry & { type: 'message' } => entry.type === 'message')
        .map((entry) => entry.message)

    let conversationContext = ''

    if (messages.length > 0) {
        const llmMessages = convertToLlm(messages)
        conversationContext = serializeConversation(llmMessages)
    }

    let fileContext = ''

    for (const file of files) {
        try {
            const fullPath = resolve(ctx.cwd, file)
            const content = readFileSync(fullPath, 'utf-8')

            fileContext += `\n\n--- File: ${file} ---\n${content}`
        } catch (err) {
            fileContext += `\n\n--- File: ${file} ---\n[Error reading file: ${err}]`
        }
    }

    let fullPrompt = ''

    if (conversationContext) {
        fullPrompt += `## Current Conversation Context\n\n${conversationContext}\n\n`
    }

    fullPrompt += `## Question for Second Opinion\n\n${prompt}`

    if (fileContext) {
        fullPrompt += `\n\n## Additional Files${fileContext}`
    }

    const friendlyModel = model.model.name || model.modelId
    const cacheKey = getThinkingCacheKey(model)
    let actualThinkingLevel = initialThinkingLevel

    const oracleResult = await ctx.ui.custom<string | null | 'aborted'>(
        (tui, _theme, _kb, done) => {
            let phase: 'loading' | 'result' = 'loading'
            let result = ''
            let currentThinkingLevel = initialThinkingLevel
            let scrollOffset = 0
            let cachedLines: string[] = []
            let cachedWidth = 0
            let finished = false

            const abortController = new AbortController()
            const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

            let spinnerIndex = 0

            const spinnerInterval = setInterval(() => {
                if (phase === 'loading') {
                    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length
                    cachedWidth = 0
                    tui.requestRender()
                }
            }, 80)

            const finish = (value: string | null | 'aborted') => {
                if (finished) {
                    return
                }

                finished = true
                clearInterval(spinnerInterval)
                done(value)
            }

            const doQuery = async () => {
                const userMessage: UserMessage = {
                    role: 'user',
                    content: [{ type: 'text', text: fullPrompt }],
                    timestamp: Date.now(),
                }

                try {
                    const queryResult = await discoverSupportedThinkingLevel({
                        initialLevel: initialThinkingLevel,
                        mode: thinkingMode,
                        run: async (level) => {
                            currentThinkingLevel = level
                            cachedWidth = 0
                            tui.requestRender()

                            const response = await completeSimple(
                                model.model,
                                {
                                    systemPrompt: ORACLE_SYSTEM_PROMPT,
                                    messages: [userMessage],
                                },
                                {
                                    apiKey: model.apiKey,
                                    headers: model.headers,
                                    signal: abortController.signal,
                                    reasoning: level === 'off' ? undefined : level,
                                },
                            )

                            if (response.stopReason === 'aborted') {
                                throw new OracleAbortedError()
                            }

                            if (response.stopReason === 'error') {
                                throw new Error(response.errorMessage || 'Unknown error')
                            }

                            return response.content
                                .filter(
                                    (c): c is { type: 'text'; text: string } => c.type === 'text',
                                )
                                .map((c) => c.text)
                                .join('\n')
                        },
                    })

                    actualThinkingLevel = queryResult.level

                    if (thinkingMode === 'auto' && queryResult.level !== initialThinkingLevel) {
                        discoveredThinkingLevels.set(cacheKey, queryResult.level)
                    }

                    return {
                        kind: 'result' as const,
                        text: queryResult.value,
                    }
                } catch (error) {
                    if (
                        error instanceof OracleAbortedError ||
                        abortController.signal.aborted ||
                        (error instanceof Error && error.name === 'AbortError')
                    ) {
                        return { kind: 'aborted' as const }
                    }

                    return {
                        kind: 'error' as const,
                        message: error instanceof Error ? error.message : String(error),
                    }
                }
            }

            doQuery().then((queryResult) => {
                if (queryResult.kind === 'aborted') {
                    finish('aborted')
                    return
                }

                if (queryResult.kind === 'error') {
                    ctx.ui.notify(`Oracle failed: ${queryResult.message}`, 'error')
                    finish('aborted')
                    return
                }

                clearInterval(spinnerInterval)
                result = queryResult.text
                phase = 'result'
                cachedWidth = 0
                tui.requestRender()
            })

            const defaultBorderColor = (_theme as any).getThinkingBorderColor
                ? (_theme as any).getThinkingBorderColor(currentThinkingLevel)
                : (s: string) => _theme.fg('accent', s)

            const bc = cockpitStyle?.borderColor ?? defaultBorderColor
            const textLight = cockpitStyle?.textLight ?? brighten(bc, 0.7)
            const accent = (s: string) => _theme.fg('accent', s)
            const muted = (s: string) => _theme.fg('muted', s)
            const dimmed = (s: string) => _theme.fg('dim', s)

            const boxLine = (content: string, innerWidth: number): string => {
                const w = visibleWidth(content)
                const pad = Math.max(0, innerWidth - w)

                return bc('│') + ' ' + content + ' '.repeat(pad) + ' ' + bc('│')
            }

            return {
                render(width: number): string[] {
                    if (cachedWidth === width && phase === 'result') {
                        return cachedLines
                    }

                    const lines: string[] = []
                    const borderW = Math.max(1, width - 2)
                    const innerWidth = Math.max(1, width - 4)

                    const titleText = ' 🔮 Oracle '
                    const textLightBold = cockpitStyle?.textLightBold ?? false
                    const styledTitle = textLight(textLightBold ? `\x1b[1m${titleText}` : titleText)
                    const titleW = visibleWidth(titleText)
                    const fillW = Math.max(0, borderW - titleW - 1)

                    lines.push(bc('╭' + '─'.repeat(fillW)) + styledTitle + bc('─╮'))

                    if (phase === 'loading') {
                        lines.push(boxLine('', innerWidth))
                        lines.push(
                            boxLine(
                                accent(spinnerFrames[spinnerIndex]) +
                                    muted(` Asking ${friendlyModel} (${currentThinkingLevel})...`),
                                innerWidth,
                            ),
                        )
                        lines.push(boxLine('', innerWidth))
                        lines.push(boxLine(keyHint('tui.select.cancel', 'cancel'), innerWidth))
                        lines.push(boxLine('', innerWidth))
                        lines.push(bc('╰' + '─'.repeat(borderW) + '╯'))

                        cachedLines = lines
                        return lines
                    }

                    const questionLine =
                        dimmed('Q: ') + truncateToWidth(prompt, innerWidth - 3, '...', true)

                    lines.push(boxLine(questionLine, innerWidth))
                    lines.push(bc('├' + '─'.repeat(borderW) + '┤'))

                    const allLines = result
                        .split('\n')
                        .flatMap((p) => (p.length === 0 ? [''] : wrapTextWithAnsi(p, innerWidth)))

                    const screenH = (tui as any).terminal?.rows || 40
                    const maxVisible = Math.min(
                        MAX_BODY_LINES,
                        Math.max(MIN_BODY_LINES, Math.round((screenH * BODY_HEIGHT_PERCENT) / 100)),
                    )

                    const maxScroll = Math.max(0, allLines.length - maxVisible)
                    scrollOffset = Math.min(scrollOffset, maxScroll)

                    const visible = allLines.slice(scrollOffset, scrollOffset + maxVisible)

                    for (const line of visible) {
                        lines.push(boxLine(line, innerWidth))
                    }

                    const hasScroll = allLines.length > maxVisible
                    const scrollInfo = hasScroll
                        ? dimmed(
                              `${scrollOffset + 1}–` +
                                  `${Math.min(scrollOffset + maxVisible, allLines.length)}` +
                                  ` of ${allLines.length}`,
                          )
                        : ''
                    const sep = dimmed(' • ')

                    const fullActions =
                        dimmed('↑/↓ or j/k:') +
                        ' scroll' +
                        sep +
                        dimmed('y/enter:') +
                        ' accept' +
                        sep +
                        dimmed('n/esc:') +
                        ' discard'

                    const shortActions =
                        dimmed('y/enter:') + ' accept' + sep + dimmed('n/esc:') + ' discard'

                    let footerContent: string

                    const fullW = visibleWidth(fullActions)
                    const scrollW = visibleWidth(scrollInfo)

                    if (hasScroll && fullW + 2 + scrollW <= innerWidth) {
                        const gap = innerWidth - fullW - scrollW
                        footerContent = fullActions + ' '.repeat(gap) + scrollInfo
                    } else if (fullW <= innerWidth) {
                        footerContent = fullActions
                    } else {
                        footerContent = truncateToWidth(shortActions, innerWidth, '...', true)
                    }

                    lines.push(bc('├' + '─'.repeat(borderW) + '┤'))
                    lines.push(boxLine(footerContent, innerWidth))
                    lines.push(bc('╰' + '─'.repeat(borderW) + '╯'))

                    cachedLines = lines
                    cachedWidth = width

                    return lines
                },

                invalidate() {
                    cachedWidth = 0
                },

                handleInput(data: string) {
                    if (_kb.matches(data, 'tui.select.cancel')) {
                        if (phase === 'loading') {
                            abortController.abort()
                            finish('aborted')
                        } else {
                            finish(null)
                        }

                        return
                    }

                    if (phase !== 'result') {
                        return
                    }

                    if (
                        matchesKey(data, 'return') ||
                        matchesKey(data, 'enter') ||
                        data === 'y' ||
                        data === 'Y'
                    ) {
                        finish(result)
                        return
                    }

                    if (data === 'n' || data === 'N') {
                        finish(null)
                        return
                    }

                    if (matchesKey(data, 'up') || data === 'k') {
                        scrollOffset = Math.max(0, scrollOffset - 1)
                        cachedWidth = 0
                        tui.requestRender()
                    } else if (matchesKey(data, 'down') || data === 'j') {
                        scrollOffset++
                        cachedWidth = 0
                        tui.requestRender()
                    }
                },
            }
        },
    )

    if (oracleResult === 'aborted') {
        ctx.ui.notify('Oracle request cancelled', 'warning')
    } else if (oracleResult !== null) {
        const displayName = `${friendlyModel} (${actualThinkingLevel})`

        pi.sendMessage({
            customType: 'oracle-response',
            content: oracleResult,
            display: true,
            details: {
                model: model.modelId,
                modelName: displayName,
                thinkingLevel: actualThinkingLevel,
                files,
                prompt,
            },
        })

        ctx.ui.notify('Oracle response added to context', 'info')
    }
}

function registerOracleExtension(pi: ExtensionAPI): void {
    let cockpitStyle: CockpitStyle | null = null

    pi.events.on('cockpit:style', (style: unknown) => {
        cockpitStyle = style as CockpitStyle
    })

    pi.registerCommand('oracle', {
        description: 'Get a second opinion from another AI model',
        handler: async (args, ctx) => {
            if (!ctx.hasUI) {
                ctx.ui.notify('oracle requires interactive mode', 'error')
                return
            }

            const trimmedArgs = args?.trim() || ''

            if (!trimmedArgs) {
                ctx.ui.notify(
                    'Usage: /oracle [-f file.ts] [-m model] [-t thinking] <prompt>',
                    'error',
                )
                return
            }

            let modelArg: string | undefined
            let thinkingArg: string | undefined
            const files: string[] = []
            const promptParts: string[] = []
            const tokens = trimmedArgs.split(/\s+/)

            let i = 0

            while (i < tokens.length) {
                const token = tokens[i]

                if (token === '-m' || token === '--model') {
                    i++
                    if (i < tokens.length) {
                        modelArg = tokens[i]
                    }
                } else if (token === '-f' || token === '--file') {
                    i++
                    if (i < tokens.length) {
                        files.push(tokens[i])
                    }
                } else if (token === '-t' || token === '--thinking') {
                    i++
                    if (i < tokens.length) {
                        thinkingArg = tokens[i]
                    }
                } else {
                    promptParts.push(...tokens.slice(i))
                    break
                }

                i++
            }

            const prompt = promptParts.join(' ')

            if (!prompt) {
                ctx.ui.notify('No prompt provided, put flags before the prompt', 'error')
                return
            }

            const config = loadConfig()
            const resolved = resolveModel(ctx, config.models, modelArg)

            if (!resolved) {
                const hint = modelArg
                    ? `Model "${modelArg}" not found or unavailable.`
                    : 'No alternative models available.'

                ctx.ui.notify(`${hint} Check oracle.json and model auth.`, 'error')
                return
            }

            const model = await authenticateModel(ctx, resolved)

            if (!model) {
                ctx.ui.notify(`No API key for ${resolved.name}. Check model auth.`, 'error')
                return
            }

            let thinkingLevel: ThinkingLevel
            let thinkingMode: ThinkingMode

            if (thinkingArg) {
                const normalized = thinkingArg.toLowerCase() as ThinkingLevel

                if (THINKING_LEVELS.includes(normalized)) {
                    thinkingLevel = normalized
                    thinkingMode = 'explicit'
                } else {
                    ctx.ui.notify(
                        `Invalid thinking level "${thinkingArg}". ` +
                            `Valid: ${THINKING_LEVELS.join(', ')}`,
                        'error',
                    )
                    return
                }
            } else {
                thinkingLevel = getInitialThinkingLevel(model, config.maxThinking)
                thinkingMode = 'auto'
            }

            await executeOracle(
                pi,
                ctx,
                prompt,
                files,
                model,
                thinkingLevel,
                thinkingMode,
                cockpitStyle,
            )
        },
    })

    pi.registerMessageRenderer('oracle-response', (message, options, theme) => {
        const { expanded } = options
        const details = (message.details || {}) as Record<string, any>

        let text = theme.fg('accent', `🔮 Oracle • ${details.modelName || 'unknown'}:\n\n`)
        text += message.content

        if (expanded && details.files?.length > 0) {
            text += '\n\n' + theme.fg('dim', `Files: ${details.files.join(', ')}`)
        }

        return new Text(text, 0, 0)
    })
}

// -----------------------------------------------------------------------------
// Extension entry point
// -----------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
    registerOracleExtension(pi)
}
