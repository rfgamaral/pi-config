import { getAgentDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Key used in Pi's global settings file for this extension. */
const CONFIG_KEY = 'tool-policy'

/** Path to Pi's global settings file. */
const SETTINGS_PATH = join(getAgentDir(), 'settings.json')

/** Default extension configuration. */
const DEFAULT_CONFIG = {
    disabledTools: [] as string[],
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Extension configuration loaded from Pi settings. */
type ToolPolicyConfig = {
    disabledTools: string[]
}

// -----------------------------------------------------------------------------
// Config functions
// -----------------------------------------------------------------------------

/** Read Pi's global settings file, returning an empty object on read or parse errors. */
function readSettingsFile(): Record<string, unknown> {
    try {
        const parsed = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))

        return typeof parsed === 'object' && parsed !== null ? parsed : {}
    } catch {
        return {}
    }
}

/** Return a clean, de-duplicated list of tool names from a raw config value. */
function normalizeToolList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return DEFAULT_CONFIG.disabledTools
    }

    const tools = value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)

    return [...new Set(tools)]
}

/** Load extension config from Pi settings with defaults applied. */
function loadConfig(): ToolPolicyConfig {
    const settings = readSettingsFile()
    const config = settings[CONFIG_KEY]

    if (!config || typeof config !== 'object') {
        return DEFAULT_CONFIG
    }

    return {
        disabledTools: normalizeToolList((config as { disabledTools?: unknown }).disabledTools),
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Apply the disabled-tool list to Pi's current active tool set. */
function applyToolPolicy(pi: ExtensionAPI): void {
    const disabled = new Set(loadConfig().disabledTools)

    if (disabled.size === 0) {
        return
    }

    const activeTools = pi.getActiveTools()
    const nextActiveTools = activeTools.filter((toolName) => !disabled.has(toolName))

    if (nextActiveTools.length !== activeTools.length) {
        pi.setActiveTools(nextActiveTools)
    }
}

// -----------------------------------------------------------------------------
// Extension entry point
// -----------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
    pi.on('session_start', async () => {
        applyToolPolicy(pi)
    })

    pi.on('before_agent_start', async () => {
        applyToolPolicy(pi)
    })

    pi.on('tool_call', async (event) => {
        const disabled = new Set(loadConfig().disabledTools)

        if (disabled.has(event.toolName)) {
            return {
                block: true,
                reason: `Tool \`${event.toolName}\` is disabled by ${CONFIG_KEY}.`,
            }
        }
    })
}
