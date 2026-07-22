import {
    getAgentDir,
    type ExtensionAPI,
    type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Path to the shared config file for this repo's custom extensions. */
const CONFIG_PATH = join(getAgentDir(), 'extensions.json')

/** Key for this extension's section in the shared config file. */
const CONFIG_KEY = 'sessionDefaults'

/** Thinking levels supported by the extension configuration. */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** Default extension configuration. */
const DEFAULT_CONFIG = {
    model: '',
    thinking: 'high' as ThinkingLevel,
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Thinking levels supported by Pi session settings. */
type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** Extension configuration loaded from the shared config file. */
type SessionDefaultsConfig = {
    model: string
    thinking: ThinkingLevel
}

// -----------------------------------------------------------------------------
// Config functions
// -----------------------------------------------------------------------------

/** Return a configured thinking level, or the default when invalid. */
function normalizeThinkingLevel(value: unknown): ThinkingLevel {
    return typeof value === 'string' && THINKING_LEVELS.includes(value as ThinkingLevel)
        ? (value as ThinkingLevel)
        : DEFAULT_CONFIG.thinking
}

/** Read this extension's section from the shared config file, empty on errors. */
function readConfigFile(): Partial<SessionDefaultsConfig> {
    try {
        const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>
        const section = parsed[CONFIG_KEY]

        return section !== null && typeof section === 'object'
            ? (section as Partial<SessionDefaultsConfig>)
            : {}
    } catch {
        return {}
    }
}

/** Load extension config from the shared config file with defaults applied. */
function loadConfig(): SessionDefaultsConfig {
    const config = readConfigFile()

    return {
        model: typeof config.model === 'string' ? config.model.trim() : DEFAULT_CONFIG.model,
        thinking: normalizeThinkingLevel(config.thinking),
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Resolve a configured provider/model pair from a Pi model specifier. */
function resolveModel(ctx: ExtensionContext, specifier: string) {
    const [provider, ...modelParts] = specifier.split('/')
    const modelId = modelParts.join('/')

    return provider && modelId ? ctx.modelRegistry.find(provider, modelId) : undefined
}

/** Whether the active persistent session has no conversation history. */
function isFreshPersistentSession(ctx: ExtensionContext): boolean {
    const entries = ctx.sessionManager.getEntries()

    return (
        Boolean(ctx.sessionManager.getSessionFile()) &&
        entries.every(
            (entry) => entry.type === 'model_change' || entry.type === 'thinking_level_change',
        )
    )
}

/** Apply the configured model and thinking level to a new persistent session. */
async function applySessionDefaults(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
    const config = loadConfig()
    if (!config.model) {
        return
    }

    const model = resolveModel(ctx, config.model)
    if (!model) {
        ctx.ui.notify(`Could not find the configured session model: ${config.model}`, 'warning')
        return
    }

    if (ctx.model?.provider !== model.provider || ctx.model.id !== model.id) {
        const didSetModel = await pi.setModel(model)
        if (!didSetModel) {
            ctx.ui.notify(`Could not use the configured session model: ${config.model}`, 'warning')
            return
        }
    }

    if (pi.getThinkingLevel() !== config.thinking) {
        // Allow the documented max level omitted by Pi's extension type
        pi.setThinkingLevel(config.thinking as Parameters<typeof pi.setThinkingLevel>[0])
    }
}

// -----------------------------------------------------------------------------
// Extension entry point
// -----------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
    pi.on('session_start', async (event, ctx) => {
        if (
            (event.reason !== 'startup' && event.reason !== 'new') ||
            !isFreshPersistentSession(ctx)
        ) {
            return
        }

        await applySessionDefaults(pi, ctx)
    })
}
