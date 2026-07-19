import { getAgentDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Path to the shared config file for this repo's custom extensions. */
const CONFIG_PATH = join(getAgentDir(), 'extensions.json')

/** Key for this extension's section in the shared config file. */
const CONFIG_KEY = 'toolPolicy'

/** Default extension configuration. */
const DEFAULT_CONFIG = {
    disabledTools: [] as string[],
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Extension configuration loaded from the shared config file. */
type ToolPolicyConfig = {
    disabledTools: string[]
}

// -----------------------------------------------------------------------------
// Config functions
// -----------------------------------------------------------------------------

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

/** Read this extension's section from the shared config file, empty on errors. */
function readConfigFile(): Partial<ToolPolicyConfig> {
    try {
        const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>
        const section = parsed[CONFIG_KEY]

        return section !== null && typeof section === 'object'
            ? (section as Partial<ToolPolicyConfig>)
            : {}
    } catch {
        return {}
    }
}

/** Load extension config from the shared config file with defaults applied. */
function loadConfig(): ToolPolicyConfig {
    const config = readConfigFile()

    return {
        disabledTools: normalizeToolList(config.disabledTools),
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
                reason: `Tool \`${event.toolName}\` is disabled by the tool-policy extension.`,
            }
        }
    })
}
