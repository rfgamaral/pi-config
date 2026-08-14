import {
    getAgentDir,
    CustomEditor,
    type ExtensionAPI,
    type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { visibleWidth, truncateToWidth } from '@earendil-works/pi-tui'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
    fetchQuotaWindows,
    quotaWindowsForModel,
    supportsQuotaProvider,
    type QuotaWindow,
} from './quota-usage'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Path to the shared config file for this repo's custom extensions. */
const CONFIG_PATH = join(getAgentDir(), 'extensions.json')

/** Key for this extension's section in the shared config file. */
const CONFIG_KEY = 'cockpitPanel'

/** Default extension configuration. */
const DEFAULT_CONFIG = {
    gitPollInterval: 5_000,
    prPollInterval: 30_000,
    usagePollInterval: 300_000,
    workspaceProfiles: {
        nameOverrides: {},
        colors: {},
    },
}

/** Abbreviated thinking level labels shown in the status widget. */
const THINKING_ICONS: Record<string, string> = {
    off: '○',
    minimal: '◔',
    low: '◑',
    medium: '◕',
    high: '●',
    xhigh: '◉',
    max: '◎',
}

/** Colored status icons matching GitHub's PR state palette. */
const PR_STATE_ICONS: Record<string, string> = {
    OPEN: '\x1b[1m\x1b[38;2;63;185;80m●\x1b[0m',
    CLOSED: '\x1b[1m\x1b[38;2;235;87;85m○\x1b[0m',
    MERGED: '\x1b[1m\x1b[38;2;163;113;247m◉\x1b[0m',
    DRAFT: '\x1b[1m\x1b[38;2;139;148;158m◌\x1b[0m',
}

/** Short display names for providers where title-casing the slug gets it wrong. */
const PROVIDER_NAMES: Record<string, string> = {
    'azure-openai-responses': 'Azure OpenAI',
    'github-copilot': 'GitHub Copilot',
    'google-antigravity': 'Antigravity',
    'google-gemini-cli': 'Gemini CLI',
    huggingface: 'HuggingFace',
    'kimi-coding': 'Kimi',
    'minimax-cn': 'MiniMax',
    minimax: 'MiniMax',
    'openai-codex': 'OpenAI Codex',
    openai: 'OpenAI',
    'opencode-go': 'OpenCode',
    opencode: 'OpenCode',
    openrouter: 'OpenRouter',
    'vercel-ai-gateway': 'Vercel',
    xai: 'xAI',
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Extension configuration loaded from disk. */
type CockpitPanelConfig = {
    workspaceProfiles: {
        nameOverrides: Record<string, string>
        colors: Record<string, string>
    }
    gitPollInterval: number
    prPollInterval: number
    usagePollInterval: number
}

/** Cached provider quota windows. */
type CachedQuota = {
    windows: QuotaWindow[]
    fetchedAt: number
}

/** Rendered quota track components. */
type QuotaTrack = {
    filled: string
    empty: string
    percent: number
    severity: 'success' | 'warning' | 'error'
}

/** CI check status counters. */
type CheckStatus = {
    total: number
    pass: number
    fail: number
    pending: number
}

/** Pull request information fetched from GitHub. */
type PrInfo = {
    number: number
    state: string
    url: string
    checks: CheckStatus
    unresolvedThreads: number
}

/** Git status for the current branch. */
type GitInfo = {
    branch: string
    dirty: boolean
    ahead: number
    behind: number
    staged: number
    modified: number
    untracked: number
}

/** In-memory cockpit-panel extension state. */
type CockpitPanelState = {
    gitPollTimer?: ReturnType<typeof setInterval>
    prPollTimer?: ReturnType<typeof setInterval>
    usagePollTimer?: ReturnType<typeof setInterval>
    quotaCache: Map<string, CachedQuota>
    quotaRequests: Map<string, AbortController>
    sessionGeneration: number
    requestRender?: () => void
}

// -----------------------------------------------------------------------------
// Config functions
// -----------------------------------------------------------------------------

/** Read this extension's section from the shared config file, empty on errors. */
function readConfigFile(): Partial<CockpitPanelConfig> {
    try {
        const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>
        const section = parsed[CONFIG_KEY]

        return section !== null && typeof section === 'object'
            ? (section as Partial<CockpitPanelConfig>)
            : {}
    } catch {
        return {}
    }
}

/** Load extension config with defaults applied. */
function loadConfig(): CockpitPanelConfig {
    const config = readConfigFile()

    const nameOverrides =
        typeof config.workspaceProfiles?.nameOverrides === 'object' &&
        config.workspaceProfiles.nameOverrides !== null
            ? config.workspaceProfiles.nameOverrides
            : DEFAULT_CONFIG.workspaceProfiles.nameOverrides
    const colors =
        typeof config.workspaceProfiles?.colors === 'object' &&
        config.workspaceProfiles.colors !== null
            ? config.workspaceProfiles.colors
            : DEFAULT_CONFIG.workspaceProfiles.colors

    return {
        ...DEFAULT_CONFIG,
        workspaceProfiles: {
            ...DEFAULT_CONFIG.workspaceProfiles,
            nameOverrides,
            colors,
        },
        gitPollInterval:
            typeof config.gitPollInterval === 'number'
                ? config.gitPollInterval
                : DEFAULT_CONFIG.gitPollInterval,
        prPollInterval:
            typeof config.prPollInterval === 'number'
                ? config.prPollInterval
                : DEFAULT_CONFIG.prPollInterval,
        usagePollInterval:
            typeof config.usagePollInterval === 'number'
                ? config.usagePollInterval
                : DEFAULT_CONFIG.usagePollInterval,
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Apply a 24-bit RGB foreground color. */
function rgb(r: number, g: number, b: number, text: string): string {
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`
}

/** Apply an 8-bit (256-palette) foreground color. */
function ansi256(code: number, text: string): string {
    return `\x1b[38;5;${code}m${text}\x1b[0m`
}

/** Wrap text in an OSC 8 hyperlink. */
function hyperlink(text: string, url: string): string {
    return url ? `\x1b]8;;${url}\x07${text}\x1b]8;;\x07` : text
}

/**
 * Derive a muted variant of a color function by lerping its RGB values
 * toward a dim gray (ansi256 240 ≈ RGB 88). Returns the original function
 * if RGB cannot be extracted. Factor 0 = pure gray, 1 = original color.
 */
function mute(colorFn: (s: string) => string, factor = 0.4): (s: string) => string {
    const sample = colorFn('X')
    const match = sample.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/)

    if (!match) {
        return colorFn
    }

    const gray = 88
    const [r, g, b] = [+match[1]!, +match[2]!, +match[3]!].map((c) =>
        Math.min(255, Math.round(gray + (c - gray) * factor)),
    )

    return (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`
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

/** Format CI check results as a colored segment (✓ / ✕ / ◔). */
function formatChecks(checks: CheckStatus, labelFn: (s: string) => string): string {
    const sep = labelFn(' •')

    if (checks.fail > 0) {
        return sep + ' ' + rgb(235, 87, 85, '✕') + labelFn(` ${checks.pass}/${checks.total}`)
    }

    if (checks.pending > 0) {
        return sep + ' ' + rgb(220, 180, 50, '◔') + labelFn(` ${checks.pass}/${checks.total}`)
    }

    return sep + ' ' + rgb(63, 185, 80, '✓') + labelFn(` ${checks.total}/${checks.total}`)
}

/**
 * Build the env object for `gh` CLI calls, ensuring GH_TOKEN is set from
 * whichever token variable is available in the current process environment.
 */
function ghEnv(): Record<string, string> {
    return {
        ...(process.env as Record<string, string>),
        GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '',
    }
}

/** Fetch PR info for the current branch using the GitHub CLI (async, non-blocking). */
async function fetchPrInfo(cwd: string): Promise<PrInfo | null> {
    try {
        const { execFile } = require('child_process')
        const { promisify } = require('util')
        const execFileAsync = promisify(execFile)

        const { stdout } = await execFileAsync(
            'gh',
            ['pr', 'view', '--json', 'number,state,isDraft,url,statusCheckRollup'],
            { cwd, timeout: 10_000, env: ghEnv() },
        )

        const trimmed = stdout.trim()

        if (!trimmed) {
            return null
        }

        const pr = JSON.parse(trimmed)

        if (!pr.number) {
            return null
        }

        const checks = parseChecks(pr.statusCheckRollup)
        const unresolvedThreads = await fetchUnresolvedThreads(cwd, pr.number, execFileAsync)

        return {
            number: pr.number,
            state: pr.isDraft ? 'DRAFT' : pr.state,
            url: pr.url ?? '',
            checks,
            unresolvedThreads,
        }
    } catch {
        return null
    }
}

/** Parse the statusCheckRollup array into pass/fail/pending counts. */
function parseChecks(rollup: unknown): CheckStatus {
    const checks: CheckStatus = { total: 0, pass: 0, fail: 0, pending: 0 }

    if (!Array.isArray(rollup)) {
        return checks
    }

    for (const c of rollup) {
        const entry = c as Record<string, string>
        const conclusion = (entry.conclusion || '').toUpperCase()
        const status = (entry.status || '').toUpperCase()

        if (!entry.name && !conclusion && !status) {
            continue
        }

        checks.total++

        if (
            conclusion === 'SUCCESS' ||
            conclusion === 'NEUTRAL' ||
            conclusion === 'SKIPPED' ||
            (status === 'COMPLETED' && !conclusion)
        ) {
            checks.pass++
        } else if (
            conclusion === 'FAILURE' ||
            conclusion === 'TIMED_OUT' ||
            conclusion === 'CANCELLED' ||
            conclusion === 'ACTION_REQUIRED'
        ) {
            checks.fail++
        } else {
            checks.pending++
        }
    }

    return checks
}

/** Query unresolved review thread count via GitHub GraphQL API. */
async function fetchUnresolvedThreads(
    cwd: string,
    prNumber: number,
    execFileAsync: Function,
): Promise<number> {
    try {
        const { stdout: repoUrl } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
            cwd,
            timeout: 3_000,
            encoding: 'utf8',
        })

        const match = repoUrl.trim().match(/github\.com[:/]([^/]+)\/([^/.]+)/)

        if (!match) {
            return 0
        }

        const [owner, name] = [match[1], match[2]]
        const query = `{ repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${prNumber}) { reviewThreads(first: 100) { nodes { isResolved } } } } }`

        const { stdout: gql } = await execFileAsync(
            'gh',
            ['api', 'graphql', '-f', `query=${query}`],
            { cwd, timeout: 10_000, env: ghEnv() },
        )

        const data = JSON.parse(gql.trim())
        const threads = data?.data?.repository?.pullRequest?.reviewThreads?.nodes

        if (Array.isArray(threads)) {
            return threads.filter((t: any) => !t.isResolved).length
        }
    } catch {}

    return 0
}

/** Detect git branch, dirty state, ahead/behind, and staged file count (async). */
async function detectGitInfo(cwd: string): Promise<GitInfo | null> {
    try {
        const { execFile } = require('child_process')
        const { promisify } = require('util')
        const execFileAsync = promisify(execFile)

        const opts = { cwd, timeout: 5_000, encoding: 'utf8' as const }

        const [branchResult, statusResult] = await Promise.all([
            execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts),
            execFileAsync('git', ['status', '--porcelain', '-uall'], opts),
        ])

        const branch = branchResult.stdout.trim()
        const status = statusResult.stdout

        let ahead = 0
        let behind = 0

        try {
            const { stdout } = await execFileAsync(
                'git',
                ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
                opts,
            )
            const [a, b] = stdout.trim().split(/\s+/)

            ahead = parseInt(a!, 10) || 0
            behind = parseInt(b!, 10) || 0
        } catch {}

        const lines = status ? status.split('\n').filter((l: string) => l.length > 0) : []
        const staged = lines.filter((l: string) => /^[MADRC]/.test(l)).length
        const modified = lines.filter(
            (l: string) => /^.[MDRC]/.test(l) && !l.startsWith('?'),
        ).length
        const untracked = lines.filter((l: string) => l.startsWith('??')).length

        return {
            branch,
            dirty: lines.length > 0,
            ahead,
            behind,
            staged,
            modified,
            untracked,
        }
    } catch {
        return null
    }
}

/**
 * Detect the project name by checking (in order):
 * 1. `name` field in `package.json`
 * 2. First `#` heading in `README.md`
 * 3. Folder basename as fallback
 */
async function detectProjectName(cwd: string): Promise<string> {
    try {
        const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'))

        if (pkg.name) {
            return pkg.name
        }
    } catch {}

    try {
        const readme = await readFile(join(cwd, 'README.md'), 'utf8')
        const match = readme.match(/^#\s+(.+)$/m)

        if (match?.[1]) {
            return match[1].trim()
        }
    } catch {}

    return basename(cwd)
}

/**
 * Find the first value in a mapping whose key is a case-insensitive
 * substring of the given value.
 */
function matchKey(mapping: Record<string, string>, value: string): string | undefined {
    const lower = value.toLowerCase()

    return Object.entries(mapping).find(([key]) => lower.includes(key.toLowerCase()))?.[1]
}

/** Resolve a provider slug to a display name. */
function providerName(slug: string): string {
    return (
        PROVIDER_NAMES[slug] ??
        slug
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')
    )
}

/** Build the git suffix string from git info (branch + indicators). */
function buildGitSuffix(git: GitInfo | null): string {
    if (!git) {
        return ''
    }

    let info = git.branch

    if (git.dirty) info += '*'
    if (git.ahead) info += ` ⇡${git.ahead}`
    if (git.behind) info += ` ⇣${git.behind}`
    if (git.staged) info += ` ≡${git.staged}`
    if (git.modified) info += ` ✎${git.modified}`
    if (git.untracked) info += ` ?${git.untracked}`

    return info
}

/** Check if a rendered line is a border (starts with `─` after stripping ANSI). */
function isBorderLine(line: string): boolean {
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, '')

    return stripped.length > 0 && stripped[0] === '─'
}

/** Format a token count for display, e.g. 1234 → "1.2k". */
function formatTokens(n: number): string {
    if (n < 1000) {
        return `${n}`
    }

    if (n < 1_000_000) {
        return `${(n / 1000).toFixed(1)}k`
    }

    return `${(n / 1_000_000).toFixed(1)}M`
}

/** Build an eight-cell quota track with a severity derived from its usage. */
export function buildQuotaTrack(usedPercent: number): QuotaTrack {
    const clamped = Math.max(0, Math.min(100, Number.isFinite(usedPercent) ? usedPercent : 0))
    const roundedCount = Math.round((clamped / 100) * 8)
    const filledCount =
        clamped === 0 ? 0 : clamped === 100 ? 8 : Math.max(1, Math.min(7, roundedCount))
    const percent =
        clamped === 0 ? 0 : clamped === 100 ? 100 : Math.max(1, Math.min(99, Math.round(clamped)))

    return {
        filled: '━'.repeat(filledCount),
        empty: '─'.repeat(8 - filledCount),
        percent,
        severity: clamped >= 90 ? 'error' : clamped >= 70 ? 'warning' : 'success',
    }
}

/**
 * Editor with a rounded box border (`╭╮│╰╯`), optional project name and git
 * info in the title bar, a prompt glyph (`❯`), and per-project border colors.
 */
class BoxEditor extends CustomEditor {
    public projectName = ''
    public gitSuffix = ''
    public customBorderColor?: (s: string) => string

    render(width: number): string[] {
        // 6 = box borders (│…│) + prompt padding ( ❯ ); 4 = corner chars (╭─…─╮)
        const editorW = width - 6
        const borderW = width - 4

        if (editorW < 1) {
            return super.render(width).map((l) => truncateToWidth(l, width))
        }

        const text = this.getText().trimStart()

        // In bash (!) or command ($) mode, use the default thinking-level border color
        const isSpecialMode = text.startsWith('!')

        const bc =
            this.customBorderColor && !isSpecialMode
                ? this.customBorderColor
                : (s: string) => this.borderColor(s)

        const textLight = brighten(bc, 0.7)
        const dividerLight = brighten(bc, 0.9)

        // Temporarily override borderColor for super.render() so internal
        // borders (top/bottom lines, scroll indicators) match our custom color
        const origBorderColor = this.borderColor

        if (this.customBorderColor && !isSpecialMode) {
            this.borderColor = this.customBorderColor
        }

        const lines = super.render(editorW)

        this.borderColor = origBorderColor

        if (lines.length < 2) {
            return lines
        }

        let bottomIdx = lines.length - 1

        for (let i = 1; i < lines.length; i++) {
            if (isBorderLine(lines[i]!)) {
                bottomIdx = i
                break
            }
        }

        const hasAutocomplete = bottomIdx < lines.length - 1

        const result: string[] = []

        for (let i = 0; i < lines.length; i++) {
            if (i === 0) {
                result.push(this.renderTopBorder(bc, textLight, dividerLight, borderW))
            } else if (i === bottomIdx && !hasAutocomplete) {
                result.push(bc('╰──') + lines[i] + bc('──╯'))
            } else if (i === bottomIdx && hasAutocomplete) {
                result.push(bc('├──') + lines[i] + bc('──┤'))
            } else {
                const prompt = i === 1 ? ' ' + textLight('❯') + ' ' : '   '
                result.push(bc('│') + prompt + lines[i] + ' ' + bc('│'))
            }
        }

        if (hasAutocomplete) {
            result.push(bc('╰─') + bc('─'.repeat(borderW)) + bc('─╯'))
        }

        return result
    }

    /**
     * Render the top border with project name and git info. Drops git info
     * first if the terminal is too narrow, then falls back to a plain border.
     */
    private renderTopBorder(
        bc: (s: string) => string,
        textLight: (s: string) => string,
        dividerLight: (s: string) => string,
        borderW: number,
    ): string {
        let showGit = !!this.gitSuffix

        let titleLabel = ` ${this.projectName}${showGit ? ` · ${this.gitSuffix}` : ''} `
        let titleW = visibleWidth(titleLabel)

        if (borderW - titleW < 0 && showGit) {
            showGit = false
            titleLabel = ` ${this.projectName} `
            titleW = visibleWidth(titleLabel)
        }

        const fillW = borderW - titleW

        if (fillW > 0) {
            // Bold is injected inside each color call because \x1b[0m resets between segments
            const nameSegment = textLight(`\x1b[1m ${this.projectName}`)

            const gitSegment = showGit
                ? dividerLight('\x1b[1m •') + textLight(`\x1b[1m ${this.gitSuffix} `)
                : ' '

            return bc('╭─') + bc('─'.repeat(fillW)) + nameSegment + gitSegment + bc('─╮')
        }

        return bc('╭─') + bc('─'.repeat(borderW)) + bc('─╮')
    }
}

// -----------------------------------------------------------------------------
// Main functions
// -----------------------------------------------------------------------------

/** Fetch the active model provider's quota windows into the session cache. */
async function refreshQuota(
    ctx: ExtensionContext,
    state: CockpitPanelState,
    generation: number,
): Promise<void> {
    try {
        if (generation !== state.sessionGeneration) {
            return
        }

        const model = ctx.model

        if (
            !model ||
            !supportsQuotaProvider(model.provider) ||
            !ctx.modelRegistry.isUsingOAuth(model) ||
            state.quotaRequests.has(model.provider)
        ) {
            return
        }

        const provider = model.provider
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10_000)

        state.quotaRequests.set(provider, controller)

        try {
            const auth = await ctx.modelRegistry.getProviderAuth(provider)
            const accessToken = auth?.auth.apiKey

            if (!accessToken) {
                return
            }

            const windows = await fetchQuotaWindows(provider, accessToken, controller.signal)

            if (generation === state.sessionGeneration) {
                state.quotaCache.set(provider, { windows, fetchedAt: Date.now() })
                state.requestRender?.()
            }
        } finally {
            clearTimeout(timeout)

            if (state.quotaRequests.get(provider) === controller) {
                state.quotaRequests.delete(provider)
            }
        }
    } catch {
        // Private quota endpoints fail silently and retain the last successful value.
    }
}

/** Return unexpired quota windows for the active OAuth model provider. */
function activeQuotaWindows(ctx: ExtensionContext, state: CockpitPanelState): QuotaWindow[] {
    const model = ctx.model

    if (
        !model ||
        !supportsQuotaProvider(model.provider) ||
        !ctx.modelRegistry.isUsingOAuth(model)
    ) {
        return []
    }

    const windows = state.quotaCache.get(model.provider)?.windows ?? []
    const now = Date.now()
    const unexpired = windows.filter(
        (window) => window.resetsAt === undefined || window.resetsAt > now,
    )

    return quotaWindowsForModel(unexpired, `${model.id} ${model.name}`)
}

/** Clear the active polling timers, if any. */
function clearPollingTimers(state: CockpitPanelState): void {
    if (state.gitPollTimer) {
        clearInterval(state.gitPollTimer)
        state.gitPollTimer = undefined
    }

    if (state.prPollTimer) {
        clearInterval(state.prPollTimer)
        state.prPollTimer = undefined
    }

    if (state.usagePollTimer) {
        clearInterval(state.usagePollTimer)
        state.usagePollTimer = undefined
    }
}

/** Set up the cockpit-panel UI for the current session. */
async function handleSessionStart(
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    state: CockpitPanelState,
): Promise<void> {
    clearPollingTimers(state)
    const generation = ++state.sessionGeneration

    state.requestRender = undefined

    ctx.ui.setFooter((_tui, _theme, _footerData) => ({
        render(_width: number): string[] {
            return []
        },
        invalidate() {},
    }))

    // Read the working directory once: the context is unusable after the session is replaced,
    // and the polling timers below outlive it
    const cwd = ctx.cwd

    const detectedName = await detectProjectName(cwd)
    const git = await detectGitInfo(cwd)
    const config = loadConfig()

    const displayName = matchKey(config.workspaceProfiles.nameOverrides, cwd) ?? detectedName
    const hex = matchKey(config.workspaceProfiles.colors, detectedName)

    let editorRef: BoxEditor | null = null

    ctx.ui.setEditorComponent((tui, theme, kb) => {
        const editor = new BoxEditor(tui, theme, kb)

        editor.projectName = displayName
        editor.gitSuffix = buildGitSuffix(git)

        if (hex) {
            const match = hex.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)

            if (match) {
                const [r, g, b] = [
                    parseInt(match[1]!, 16),
                    parseInt(match[2]!, 16),
                    parseInt(match[3]!, 16),
                ]

                editor.customBorderColor = (s: string) => rgb(r, g, b, s)
            }
        }

        editorRef = editor

        return editor
    })

    let customBorderColor: ((s: string) => string) | null = null

    if (hex) {
        const match = hex.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)

        if (match) {
            const [r, g, b] = [
                parseInt(match[1]!, 16),
                parseInt(match[2]!, 16),
                parseInt(match[3]!, 16),
            ]

            customBorderColor = (s: string) => rgb(r, g, b, s)
        }
    }

    if (customBorderColor) {
        pi.events.emit('cockpit:style', {
            borderColor: customBorderColor,
            textLight: brighten(customBorderColor, 0.7),
            textLightBold: true,
        })
    }

    let prInfo: PrInfo | null = null

    fetchPrInfo(cwd).then((pr) => {
        prInfo = pr
        state.requestRender?.()
    })

    state.gitPollTimer = setInterval(async () => {
        const updatedGit = await detectGitInfo(cwd)

        if (editorRef) {
            editorRef.gitSuffix = buildGitSuffix(updatedGit)
            state.requestRender?.()
        }
    }, config.gitPollInterval)

    state.prPollTimer = setInterval(async () => {
        prInfo = await fetchPrInfo(cwd)
        state.requestRender?.()
    }, config.prPollInterval)

    ctx.ui.setWidget(
        'model-info',
        (tui, theme) => {
            state.requestRender = () => tui.requestRender()

            return {
                render: (width: number) => {
                    const dim = (s: string) => ansi256(240, s)
                    const label = (s: string) => ansi256(252, s)
                    const commentIcon = (s: string) => rgb(140, 200, 255, s)

                    const leftSegments: string[] = []

                    if (prInfo) {
                        leftSegments.push(
                            ` ${PR_STATE_ICONS[prInfo.state] ?? '?'}` +
                                label(` PR `) +
                                hyperlink(rgb(255, 255, 187, `#${prInfo.number}`), prInfo.url),
                        )

                        if (prInfo.checks.total > 0) {
                            leftSegments.push(formatChecks(prInfo.checks, label))
                        }

                        if (prInfo.unresolvedThreads > 0) {
                            leftSegments.push(
                                label(` • `) +
                                    commentIcon(`✎`) +
                                    label(` ${prInfo.unresolvedThreads}`),
                            )
                        }
                    }

                    const modelName = (ctx.model?.name ?? ctx.model?.id ?? 'no model').replace(
                        /^Claude\s+/i,
                        '',
                    )
                    const provider = providerName(ctx.model?.provider ?? '')
                    const thinking = pi.getThinkingLevel()
                    const thinkingIcon = THINKING_ICONS[thinking] ?? '?'
                    const thinkingColor = editorRef ? mute(editorRef.borderColor, 0.5) : dim
                    const modelBlock =
                        dim(`${modelName} (`) + thinkingColor(thinkingIcon) + dim(')')
                    const quotaWindows = activeQuotaWindows(ctx, state)
                    const usage = ctx.getContextUsage()

                    let tokenBlock: string | undefined
                    let contextBlock: string | undefined

                    if (usage?.tokens != null && usage?.contextWindow) {
                        let inputTokens = 0
                        let outputTokens = 0

                        for (const entry of ctx.sessionManager.getBranch()) {
                            if (entry.type === 'message' && entry.message.role === 'assistant') {
                                const message = entry.message as any

                                inputTokens += message.usage?.input ?? 0
                                outputTokens += message.usage?.output ?? 0
                            }
                        }

                        tokenBlock = dim(
                            `↑${formatTokens(inputTokens)} ↓${formatTokens(outputTokens)}`,
                        )

                        const percent = Math.round((usage.tokens / usage.contextWindow) * 100)

                        contextBlock = dim(
                            `${formatTokens(usage.tokens)}/${formatTokens(usage.contextWindow)} (${percent}%)`,
                        )
                    }

                    let showProvider = !!provider
                    let showTokenBlock = !!tokenBlock
                    let showContextBlock = !!contextBlock
                    let compactQuota = false
                    const visibleQuotaWindows = [...quotaWindows]

                    const formatQuota = (window: QuotaWindow): string => {
                        const track = buildQuotaTrack(window.usedPercent)

                        if (compactQuota) {
                            return dim(`${window.label} ${track.percent}%`)
                        }

                        const filled = track.filled ? theme.fg(track.severity, track.filled) : ''

                        return (
                            dim(`${window.label} `) +
                            filled +
                            dim(`${track.empty} ${track.percent}%`)
                        )
                    }

                    const renderRight = (): string => {
                        const blocks: string[] = []

                        if (showProvider) blocks.push(dim(provider))
                        blocks.push(modelBlock)
                        blocks.push(...visibleQuotaWindows.map(formatQuota))
                        if (showTokenBlock && tokenBlock) blocks.push(tokenBlock)
                        if (showContextBlock && contextBlock) blocks.push(contextBlock)

                        return blocks.join(dim(' • ')) + dim(' ')
                    }

                    let left = leftSegments.join('')
                    let right = renderRight()
                    let leftWidth = visibleWidth(left)
                    let rightWidth = visibleWidth(right)

                    while (leftWidth + rightWidth + 1 > width) {
                        if (showContextBlock) {
                            showContextBlock = false
                        } else if (showTokenBlock) {
                            showTokenBlock = false
                        } else if (leftSegments.length > 1) {
                            leftSegments.pop()
                        } else if (showProvider) {
                            showProvider = false
                        } else if (!compactQuota && visibleQuotaWindows.length > 0) {
                            compactQuota = true
                        } else if (visibleQuotaWindows.length > 0) {
                            visibleQuotaWindows.pop()
                        } else if (leftSegments.length > 0) {
                            leftSegments.pop()
                        } else {
                            break
                        }

                        left = leftSegments.join('')
                        right = renderRight()
                        leftWidth = visibleWidth(left)
                        rightWidth = visibleWidth(right)
                    }

                    const gap = Math.max(1, width - leftWidth - rightWidth)

                    return [truncateToWidth(left + ' '.repeat(gap) + right, width)]
                },
                invalidate() {},
            }
        },
        { placement: 'belowEditor' },
    )

    void refreshQuota(ctx, state, generation)

    state.usagePollTimer = setInterval(() => {
        void refreshQuota(ctx, state, generation)
    }, config.usagePollInterval)
}

/** Tear down any cockpit-panel session resources. */
function handleSessionShutdown(state: CockpitPanelState): void {
    state.sessionGeneration++
    clearPollingTimers(state)

    for (const controller of state.quotaRequests.values()) {
        controller.abort()
    }

    state.quotaRequests.clear()
    state.requestRender = undefined
}

// -----------------------------------------------------------------------------
// Extension entry point
// -----------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
    const state: CockpitPanelState = {
        quotaCache: new Map(),
        quotaRequests: new Map(),
        sessionGeneration: 0,
    }

    pi.on('session_start', async (_event, ctx) => {
        await handleSessionStart(pi, ctx, state)
    })

    pi.on('model_select', (event, ctx) => {
        state.requestRender?.()

        if (event.model.provider !== event.previousModel?.provider) {
            void refreshQuota(ctx, state, state.sessionGeneration)
        }
    })

    pi.on('session_shutdown', () => {
        handleSessionShutdown(state)
    })
}
