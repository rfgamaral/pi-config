import {
    BorderedLoader,
    DynamicBorder,
    getAgentDir,
    keyHint,
    rawKeyHint,
    type ExtensionAPI,
    type ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent'
import {
    Container,
    fuzzyMatch,
    Input,
    matchesKey,
    Spacer,
    truncateToWidth,
    visibleWidth,
} from '@earendil-works/pi-tui'
import { spawnSync } from 'node:child_process'
import { createReadStream, readFileSync, type Dirent } from 'node:fs'
import { link, mkdir, readdir, realpath, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { stripVTControlCharacters } from 'node:util'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Path to the shared config file for this repo's custom extensions. */
const CONFIG_PATH = join(getAgentDir(), 'extensions.json')

/** Key for this extension's section in the shared config file. */
const CONFIG_KEY = 'sessionSnap'

/** Root directory for Pi's standard session files. */
const SESSIONS_ROOT = join(getAgentDir(), 'sessions')

/** Filesystem-only archive, nested deeply enough to stay out of `/resume`. */
const ARCHIVE_ROOT = join(SESSIONS_ROOT, '.archive')

/** Root directory for optional Session Favorites marker files. */
const FAVORITES_ROOT = join(getAgentDir(), 'favorites')

/** Default extension configuration. */
const DEFAULT_CONFIG: SessionSnapConfig = {
    deleteMaxDurationMinutes: 5,
    deleteMaxUserMessages: 3,
    archiveAfterDays: 180,
    keepFavorites: true,
}

/** Session Snap's approved action and metadata palette. */
const SNAP_COLORS = {
    delete: [255, 161, 153],
    keep: [138, 223, 141],
    archive: [241, 191, 78],
    project: [155, 170, 190],
    metadata: [105, 110, 122],
} as const

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Extension configuration loaded from disk. */
type SessionSnapConfig = {
    deleteMaxDurationMinutes: number
    deleteMaxUserMessages: number
    archiveAfterDays: number
    keepFavorites: boolean
}

/** Cleanup action assigned to a scanned session. */
type SessionAction = 'delete' | 'archive' | 'keep'

/** Metrics collected from a standard Pi session file. */
type SessionMetrics = {
    path: string
    projectDirectory: string
    id: string
    cwd: string
    name?: string
    firstMessage: string
    createdAt: number
    lastActivityAt: number
    durationMinutes: number
    messageCount: number
    userMessageCount: number
    fileSizeBytes: number
    favorite: boolean
}

/** Session metrics collected before optional favorite-marker lookup. */
type ParsedSessionMetrics = Omit<SessionMetrics, 'favorite'>

/** Scanned session with its proposed cleanup action. */
type ClassifiedSession = SessionMetrics & {
    action: SessionAction
}

/** One session file omitted because it could not be classified safely. */
type SkippedSession = {
    path: string
    projectDirectory: string
    reason: string
}

/** Complete scan output, including session files skipped safely. */
type ScanResult = {
    sessions: ClassifiedSession[]
    skipped: SkippedSession[]
}

/** Fixed review tabs based on each session's initial scan result. */
type ReviewTab = 'all' | SessionAction | 'skipped'

/** User-reviewed actions and the visible tab/filter scope to apply. */
type ReviewResult = {
    actions: Map<string, SessionAction>
    scope: Set<string>
    tab: ReviewTab
    filter: string
    selectedPath?: string
}

/** Review location restored after confirmation or filesystem actions. */
type ReviewViewState = Pick<ReviewResult, 'tab' | 'filter' | 'selectedPath'>

/** One parsed search token matching `/resume` query behavior. */
type ReviewSearchToken = {
    kind: 'fuzzy' | 'phrase'
    value: string
}

/** Regex or tokenized search query used by the review screen. */
type ReviewSearchQuery =
    | { mode: 'regex'; regex: RegExp | null }
    | { mode: 'tokens'; tokens: ReviewSearchToken[] }

/** One valid or skipped row in the review screen. */
type ReviewRow =
    | { kind: 'session'; session: ClassifiedSession }
    | { kind: 'skipped'; session: SkippedSession }

/** One valid or skipped session that can be passed to filesystem execution. */
type CleanupTarget = ClassifiedSession | SkippedSession

/** One file operation that failed without stopping the remaining actions. */
type ExecutionFailure = {
    session: CleanupTarget
    error: string
}

/** Counts and failures from executing the reviewed action set. */
type ExecutionResult = {
    deleted: string[]
    archived: string[]
    failures: ExecutionFailure[]
}

// -----------------------------------------------------------------------------
// Config functions
// -----------------------------------------------------------------------------

/** Read this extension's section from the shared config file, empty on errors. */
function readConfigFile(): Partial<SessionSnapConfig> {
    try {
        const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>
        const section = parsed[CONFIG_KEY]

        return section !== null && typeof section === 'object'
            ? (section as Partial<SessionSnapConfig>)
            : {}
    } catch {
        return {}
    }
}

/** Load extension config with independently validated defaults. */
function loadConfig(): SessionSnapConfig {
    const config = readConfigFile()

    return {
        deleteMaxDurationMinutes:
            typeof config.deleteMaxDurationMinutes === 'number' &&
            Number.isFinite(config.deleteMaxDurationMinutes) &&
            config.deleteMaxDurationMinutes > 0
                ? config.deleteMaxDurationMinutes
                : DEFAULT_CONFIG.deleteMaxDurationMinutes,
        deleteMaxUserMessages:
            typeof config.deleteMaxUserMessages === 'number' &&
            Number.isInteger(config.deleteMaxUserMessages) &&
            config.deleteMaxUserMessages > 0
                ? config.deleteMaxUserMessages
                : DEFAULT_CONFIG.deleteMaxUserMessages,
        archiveAfterDays:
            typeof config.archiveAfterDays === 'number' &&
            Number.isFinite(config.archiveAfterDays) &&
            config.archiveAfterDays > 0
                ? config.archiveAfterDays
                : DEFAULT_CONFIG.archiveAfterDays,
        keepFavorites:
            typeof config.keepFavorites === 'boolean'
                ? config.keepFavorites
                : DEFAULT_CONFIG.keepFavorites,
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Return an error's filesystem code when available. */
function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return undefined
    }

    return typeof error.code === 'string' ? error.code : undefined
}

/** Read a directory, treating a missing directory as empty. */
async function readDirectory(path: string): Promise<Dirent[]> {
    try {
        return await readdir(path, { withFileTypes: true })
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            return []
        }

        throw error
    }
}

/** Parse one JSONL line, returning only object entries. */
function parseEntry(line: string): Record<string, unknown> | null {
    if (!line.trim()) {
        return null
    }

    try {
        const entry: unknown = JSON.parse(line)

        return typeof entry === 'object' && entry !== null
            ? (entry as Record<string, unknown>)
            : null
    } catch {
        return null
    }
}

/** Parse a finite millisecond timestamp or date string. */
function parseTimestamp(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined
    }

    if (typeof value !== 'string') {
        return undefined
    }

    const timestamp = Date.parse(value)

    return Number.isFinite(timestamp) ? timestamp : undefined
}

/** Extract string and text-block content from a session message. */
function extractText(content: unknown): string {
    if (typeof content === 'string') {
        return content
    }

    if (!Array.isArray(content)) {
        return ''
    }

    return content
        .filter(
            (block): block is { type: 'text'; text: string } =>
                typeof block === 'object' &&
                block !== null &&
                (block as { type?: unknown }).type === 'text' &&
                typeof (block as { text?: unknown }).text === 'string',
        )
        .map((block) => block.text)
        .join(' ')
}

/** Remove terminal controls and collapse whitespace for safe plain-text display. */
function cleanDisplayText(text: string): string {
    return stripVTControlCharacters(text)
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Truncate trusted plain text without retaining the helper's ANSI reset codes. */
function truncatePlainText(text: string, width: number, ellipsis = '…'): string {
    return stripVTControlCharacters(truncateToWidth(text, width, ellipsis))
}

/** Parse regex, fuzzy-token, and quoted-phrase search syntax like `/resume`. */
function parseReviewSearch(query: string): ReviewSearchQuery {
    const trimmed = query.trim()

    if (trimmed.startsWith('re:')) {
        const pattern = trimmed.slice(3).trim()

        if (!pattern) {
            return { mode: 'regex', regex: null }
        }

        try {
            return { mode: 'regex', regex: new RegExp(pattern, 'i') }
        } catch {
            return { mode: 'regex', regex: null }
        }
    }

    const tokens: ReviewSearchToken[] = []
    let buffer = ''
    let inQuote = false
    const flush = (kind: ReviewSearchToken['kind']) => {
        const value = buffer.trim()

        buffer = ''

        if (value) {
            tokens.push({ kind, value })
        }
    }

    for (const character of trimmed) {
        if (character === '"') {
            flush(inQuote ? 'phrase' : 'fuzzy')
            inQuote = !inQuote
        } else if (!inQuote && /\s/.test(character)) {
            flush('fuzzy')
        } else {
            buffer += character
        }
    }

    if (inQuote) {
        return {
            mode: 'tokens',
            tokens: trimmed
                .split(/\s+/)
                .filter(Boolean)
                .map((value) => ({ kind: 'fuzzy', value })),
        }
    }

    flush('fuzzy')
    return { mode: 'tokens', tokens }
}

/** Filter review rows by `/resume`-style search relevance. */
function filterReviewRows(
    rows: ReviewRow[],
    query: string,
    getText: (row: ReviewRow) => string,
): ReviewRow[] {
    if (!query.trim()) {
        return rows
    }

    const parsed = parseReviewSearch(query)
    const scored: Array<{ row: ReviewRow; score: number }> = []

    for (const row of rows) {
        const text = getText(row)
        let score = 0

        if (parsed.mode === 'regex') {
            if (!parsed.regex) {
                continue
            }

            const index = text.search(parsed.regex)

            if (index < 0) {
                continue
            }

            score = index * 0.1
        } else {
            let matches = true

            for (const token of parsed.tokens) {
                if (token.kind === 'phrase') {
                    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ').trim()
                    const phrase = token.value.toLowerCase().replace(/\s+/g, ' ').trim()
                    const index = normalizedText.indexOf(phrase)

                    if (index < 0) {
                        matches = false
                        break
                    }

                    score += index * 0.1
                } else {
                    const match = fuzzyMatch(token.value, text)

                    if (!match.matches) {
                        matches = false
                        break
                    }

                    score += match.score
                }
            }

            if (!matches) {
                continue
            }
        }

        scored.push({ row, score })
    }

    scored.sort((left, right) => left.score - right.score)
    return scored.map(({ row }) => row)
}

/** Map an RGB color to its nearest xterm 256-color approximation. */
function rgbToAnsi256([red, green, blue]: readonly [number, number, number]): number {
    const levels = [0, 95, 135, 175, 215, 255]
    const indexes = [red, green, blue].map((value) =>
        levels.reduce(
            (best, level, index) =>
                Math.abs(level - value) < Math.abs(levels[best] - value) ? index : best,
            0,
        ),
    )
    const cube = [
        levels[indexes[0]],
        levels[indexes[1]],
        levels[indexes[2]],
        16 + 36 * indexes[0] + 6 * indexes[1] + indexes[2],
    ]
    const grayIndex = Math.max(0, Math.min(23, Math.round(((red + green + blue) / 3 - 8) / 10)))
    const grayValue = 8 + 10 * grayIndex
    const distance = ([candidateRed, candidateGreen, candidateBlue]: number[]) =>
        (red - candidateRed) ** 2 + (green - candidateGreen) ** 2 + (blue - candidateBlue) ** 2

    return distance(cube) <= distance([grayValue, grayValue, grayValue]) ? cube[3] : 232 + grayIndex
}

/** Color text with Session Snap's palette in truecolor or 256-color terminals. */
function snapColor(
    rgb: readonly [number, number, number],
    truecolor: boolean,
    text: string,
): string {
    const color = truecolor ? `38;2;${rgb.join(';')}` : `38;5;${rgbToAnsi256(rgb)}`

    return `\u001B[${color}m${text}\u001B[39m`
}

/** Return true for a safe, extensionless Pi session ID marker name. */
function isMarkerName(name: string): boolean {
    return /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/.test(name)
}

/** Read one standard Pi session file into cleanup metrics. */
async function scanSession(
    filePath: string,
    projectDirectory: string,
    signal?: AbortSignal,
): Promise<ParsedSessionMetrics | null> {
    let stream: ReturnType<typeof createReadStream> | undefined
    let lines: ReturnType<typeof createInterface> | undefined

    try {
        signal?.throwIfAborted()

        const fileStats = await stat(filePath)

        signal?.throwIfAborted()

        let header: Record<string, unknown> | undefined
        let name: string | undefined
        let firstMessage = ''
        let messageCount = 0
        let userMessageCount = 0
        let lastActivityAt: number | undefined

        stream = createReadStream(filePath, { encoding: 'utf8' })
        lines = createInterface({ input: stream, crlfDelay: Infinity })

        for await (const line of lines) {
            signal?.throwIfAborted()

            const entry = parseEntry(line)

            if (!entry) {
                if (header && line.trim()) {
                    return null
                }

                continue
            }

            if (!header) {
                if (entry.type !== 'session' || typeof entry.id !== 'string') {
                    return null
                }

                header = entry
                continue
            }

            if (entry.type === 'session_info') {
                name = typeof entry.name === 'string' ? entry.name.trim() || undefined : undefined
                continue
            }

            if (entry.type !== 'message') {
                continue
            }

            messageCount += 1

            if (typeof entry.message !== 'object' || !entry.message) {
                continue
            }

            const message = entry.message as Record<string, unknown>

            if (message.role !== 'user' && message.role !== 'assistant') {
                continue
            }

            const messageTimestamp =
                typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
                    ? message.timestamp
                    : parseTimestamp(entry.timestamp)

            if (messageTimestamp !== undefined) {
                lastActivityAt = Math.max(lastActivityAt ?? messageTimestamp, messageTimestamp)
            }

            if (message.role !== 'user') {
                continue
            }

            userMessageCount += 1

            if (!firstMessage) {
                firstMessage = extractText(message.content).trim()
            }
        }

        if (!header) {
            return null
        }

        const createdAt = parseTimestamp(header.timestamp) ?? fileStats.mtimeMs
        const resolvedLastActivityAt = lastActivityAt ?? createdAt

        return {
            path: filePath,
            projectDirectory,
            id: header.id as string,
            cwd: typeof header.cwd === 'string' ? header.cwd : '',
            name,
            firstMessage,
            createdAt,
            lastActivityAt: resolvedLastActivityAt,
            durationMinutes: Math.max(0, resolvedLastActivityAt - createdAt) / 60_000,
            messageCount,
            userMessageCount,
            fileSizeBytes: fileStats.size,
        }
    } finally {
        lines?.close()
        stream?.close()
    }
}

/** Check for a regular Session Favorites marker file. */
async function isFavorite(projectDirectory: string, sessionId: string): Promise<boolean> {
    if (!isMarkerName(sessionId)) {
        return false
    }

    try {
        return (await stat(join(FAVORITES_ROOT, projectDirectory, sessionId))).isFile()
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            return false
        }

        throw error
    }
}

/** Classify one session using the configured cleanup priority and strict thresholds. */
function classifySession(metrics: SessionMetrics, config: SessionSnapConfig): SessionAction {
    if (config.keepFavorites && metrics.favorite) {
        return 'keep'
    }

    if (
        metrics.durationMinutes < config.deleteMaxDurationMinutes &&
        metrics.userMessageCount < config.deleteMaxUserMessages
    ) {
        return 'delete'
    }

    const ageDays = (Date.now() - metrics.lastActivityAt) / 86_400_000

    return ageDays > config.archiveAfterDays ? 'archive' : 'keep'
}

/** Return whether a canonical path is a strict child of a canonical root. */
function isPathInside(root: string, candidate: string): boolean {
    const pathFromRoot = relative(root, candidate)

    return (
        pathFromRoot !== '' &&
        pathFromRoot !== '..' &&
        !pathFromRoot.startsWith(`..${sep}`) &&
        !isAbsolute(pathFromRoot)
    )
}

/** Scan and classify direct JSONL children of Pi's standard project directories. */
async function scanSessions(
    config: SessionSnapConfig,
    currentSessionFile: string | undefined,
    signal?: AbortSignal,
): Promise<ScanResult> {
    const sessions: ClassifiedSession[] = []
    const currentPath = currentSessionFile ? resolve(currentSessionFile) : undefined
    let currentCanonicalPath: string | undefined

    if (currentSessionFile) {
        try {
            currentCanonicalPath = await realpath(currentSessionFile)
        } catch (error) {
            if (getErrorCode(error) !== 'ENOENT') {
                throw error
            }

            currentCanonicalPath = join(
                await realpath(dirname(currentSessionFile)),
                basename(currentSessionFile),
            )
        }
    }

    const canonicalSessionsRoot = await realpath(SESSIONS_ROOT)
    let canonicalArchiveRoot: string | undefined

    try {
        canonicalArchiveRoot = await realpath(ARCHIVE_ROOT)
    } catch (error) {
        if (getErrorCode(error) !== 'ENOENT') {
            throw error
        }
    }

    if (canonicalArchiveRoot && !isPathInside(canonicalSessionsRoot, canonicalArchiveRoot)) {
        throw new Error('Session archive resolves outside the sessions directory')
    }

    const projectEntries = await readDirectory(SESSIONS_ROOT)
    const skipped: SkippedSession[] = []
    const seenPaths = new Set<string>()

    for (const projectEntry of projectEntries) {
        signal?.throwIfAborted()

        if (
            projectEntry.name === '.archive' ||
            (!projectEntry.isDirectory() && !projectEntry.isSymbolicLink())
        ) {
            continue
        }

        const projectDirectory = projectEntry.name
        const projectPath = join(SESSIONS_ROOT, projectDirectory)
        const canonicalProjectPath = await realpath(projectPath)

        if (
            !isPathInside(canonicalSessionsRoot, canonicalProjectPath) ||
            (canonicalArchiveRoot &&
                (canonicalProjectPath === canonicalArchiveRoot ||
                    isPathInside(canonicalArchiveRoot, canonicalProjectPath)))
        ) {
            throw new Error(
                `Session project resolves outside the active sessions directory: ${projectDirectory}`,
            )
        }

        const sessionEntries = await readDirectory(projectPath)

        for (const sessionEntry of sessionEntries) {
            signal?.throwIfAborted()

            if (!sessionEntry.isFile() || !sessionEntry.name.endsWith('.jsonl')) {
                continue
            }

            const filePath = join(SESSIONS_ROOT, projectDirectory, sessionEntry.name)
            let canonicalPath: string

            try {
                canonicalPath = await realpath(filePath)
            } catch (error) {
                skipped.push({
                    path: filePath,
                    projectDirectory,
                    reason: error instanceof Error ? error.message : String(error),
                })
                continue
            }

            if (
                !isPathInside(canonicalSessionsRoot, canonicalPath) ||
                (canonicalArchiveRoot && isPathInside(canonicalArchiveRoot, canonicalPath))
            ) {
                throw new Error(
                    `Session file resolves outside the active sessions directory: ${filePath}`,
                )
            }

            if (
                resolve(filePath) === currentPath ||
                canonicalPath === currentCanonicalPath ||
                seenPaths.has(canonicalPath)
            ) {
                continue
            }

            seenPaths.add(canonicalPath)
            let parsed: ParsedSessionMetrics | null

            try {
                parsed = await scanSession(filePath, projectDirectory, signal)
            } catch (error) {
                if (signal?.aborted) {
                    throw error
                }

                skipped.push({
                    path: filePath,
                    projectDirectory,
                    reason: error instanceof Error ? error.message : String(error),
                })
                continue
            }

            if (!parsed) {
                skipped.push({
                    path: filePath,
                    projectDirectory,
                    reason: 'Malformed or unsupported session file',
                })
                continue
            }

            const favorite = config.keepFavorites
                ? await isFavorite(projectDirectory, parsed.id)
                : false
            const metrics: SessionMetrics = { ...parsed, favorite }

            sessions.push({ ...metrics, action: classifySession(metrics, config) })
        }
    }

    const actionOrder: Record<SessionAction, number> = { delete: 0, archive: 1, keep: 2 }

    sessions.sort(
        (left, right) =>
            actionOrder[left.action] - actionOrder[right.action] ||
            left.lastActivityAt - right.lastActivityAt,
    )

    return { sessions, skipped }
}

/** Format a byte count for compact display. */
function formatBytes(bytes: number): string {
    if (bytes < 1_024) {
        return `${bytes} B`
    }

    if (bytes < 1_048_576) {
        return `${(bytes / 1_024).toFixed(1)} KB`
    }

    return `${(bytes / 1_048_576).toFixed(1)} MB`
}

/** Format session activity age with the same compact units as `/resume`. */
function formatSessionDate(timestamp: number): string {
    const diffMs = Date.now() - timestamp
    const diffMinutes = Math.floor(diffMs / 60_000)
    const diffHours = Math.floor(diffMs / 3_600_000)
    const diffDays = Math.floor(diffMs / 86_400_000)

    if (diffMinutes < 1) return 'now'
    if (diffMinutes < 60) return `${diffMinutes}m`
    if (diffHours < 24) return `${diffHours}h`
    if (diffDays < 7) return `${diffDays}d`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`

    return `${Math.floor(diffDays / 365)}y`
}

/** Return the final CWD segment, falling back to Pi's encoded project directory. */
function projectName(cwd: string, projectDirectory: string): string {
    return basename(cleanDisplayText(cwd)) || cleanDisplayText(projectDirectory)
}

/** Return the display name or first user message for a valid session. */
function sessionTitle(session: ClassifiedSession): string {
    return (
        cleanDisplayText(session.name ?? '') ||
        cleanDisplayText(session.firstMessage) ||
        '(empty session)'
    )
}

/** Move one session into its matching filesystem-only archive directory. */
async function archiveSession(session: ClassifiedSession): Promise<void> {
    const { projectDirectory } = session

    if (
        !projectDirectory ||
        isAbsolute(projectDirectory) ||
        projectDirectory === '..' ||
        projectDirectory.startsWith(`..${sep}`)
    ) {
        throw new Error(`Invalid session project directory: ${projectDirectory}`)
    }

    const target = join(ARCHIVE_ROOT, projectDirectory, basename(session.path))

    await mkdir(dirname(target), { recursive: true })

    let targetExists = true

    try {
        await stat(target)
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            targetExists = false
        } else {
            throw error
        }
    }

    if (targetExists) {
        throw new Error(`Archive target already exists: ${target}`)
    }

    try {
        await link(session.path, target)
    } catch (error) {
        if (getErrorCode(error) === 'EEXIST') {
            throw new Error(`Archive target already exists: ${target}`)
        }

        throw error
    }

    try {
        await unlink(session.path)
    } catch (error) {
        try {
            await unlink(target)
        } catch (rollbackError) {
            if (getErrorCode(rollbackError) !== 'ENOENT') {
                const sourceMessage = error instanceof Error ? error.message : String(error)
                const rollbackMessage =
                    rollbackError instanceof Error ? rollbackError.message : String(rollbackError)

                throw new Error(
                    `Could not remove archive source: ${sourceMessage}; ` +
                        `archive rollback failed: ${rollbackMessage}`,
                )
            }
        }

        throw error
    }
}

/** Return whether a path exists, treating only ENOENT as absent. */
async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            return false
        }

        throw error
    }
}

/** Delete one session through trash when possible, with permanent unlink fallback. */
async function deleteSession(filePath: string): Promise<'trash' | 'unlink'> {
    const trashArgs = filePath.startsWith('-') ? ['--', filePath] : [filePath]
    const result = spawnSync('trash', trashArgs, { encoding: 'utf8' })

    if (result.status === 0 || !(await pathExists(filePath))) {
        return 'trash'
    }

    await unlink(filePath)
    return 'unlink'
}

// -----------------------------------------------------------------------------
// Main functions
// -----------------------------------------------------------------------------

/** Review scanned sessions through a list styled after Pi's native `/resume` selector. */
async function reviewCandidates(
    ctx: ExtensionCommandContext,
    scanResult: ScanResult,
    actions: Map<string, SessionAction>,
    initialView?: ReviewViewState,
): Promise<ReviewResult | null> {
    const validRows: ReviewRow[] = scanResult.sessions.map((session) => ({
        kind: 'session',
        session,
    }))
    const skippedRows: ReviewRow[] = scanResult.skipped.map((session) => ({
        kind: 'skipped',
        session,
    }))
    const rowsByTab: Record<ReviewTab, ReviewRow[]> = {
        all: validRows,
        delete: validRows.filter(
            (row) => row.kind === 'session' && row.session.action === 'delete',
        ),
        archive: validRows.filter(
            (row) => row.kind === 'session' && row.session.action === 'archive',
        ),
        keep: validRows.filter((row) => row.kind === 'session' && row.session.action === 'keep'),
        skipped: skippedRows,
    }
    const tabs = (['all', 'delete', 'archive', 'keep', 'skipped'] as ReviewTab[]).filter(
        (tab) => rowsByTab[tab].length > 0,
    )
    const projectColumnWidth = Math.min(
        24,
        Math.max(
            2,
            ...[...validRows, ...skippedRows].map((row) => {
                const project =
                    row.kind === 'session'
                        ? projectName(row.session.cwd, row.session.projectDirectory)
                        : cleanDisplayText(row.session.projectDirectory)

                return visibleWidth(`[${project}]`)
            }),
        ),
    )
    const countColumnWidth = Math.max(
        1,
        ...scanResult.sessions.map((session) => String(session.messageCount).length),
    )
    const ageColumnWidth = Math.max(
        3,
        ...scanResult.sessions.map((session) => formatSessionDate(session.lastActivityAt).length),
    )
    const visibleRows = 10

    return ctx.ui.custom<ReviewResult | null>((tui, theme, keybindings, done) => {
        const restoredTabIndex = initialView ? tabs.indexOf(initialView.tab) : -1
        let activeTabIndex = Math.max(0, restoredTabIndex)
        let selectedIndex = 0
        let filteredRows = rowsByTab[tabs[activeTabIndex]]
        let focused = false
        const searchInput = new Input()

        searchInput.setValue(initialView?.filter ?? '')
        const container = new Container()
        const activeTab = () => tabs[activeTabIndex]
        const rowSearchText = (row: ReviewRow) =>
            row.kind === 'session'
                ? `${row.session.id} ${projectName(
                      row.session.cwd,
                      row.session.projectDirectory,
                  )} ${sessionTitle(row.session)} ${row.session.path}`
                : `${cleanDisplayText(row.session.projectDirectory)} ${cleanDisplayText(
                      basename(row.session.path),
                  )} ${cleanDisplayText(row.session.reason)} ${row.session.path}`
        const filterRows = () => {
            const rows = rowsByTab[activeTab()]
            const query = searchInput.getValue()

            filteredRows = filterReviewRows(rows, query, rowSearchText)
            selectedIndex = Math.min(selectedIndex, Math.max(0, filteredRows.length - 1))
        }
        filterRows()

        if (initialView?.selectedPath) {
            const restoredSelectedIndex = filteredRows.findIndex(
                (row) => row.session.path === initialView.selectedPath,
            )

            if (restoredSelectedIndex >= 0) {
                selectedIndex = restoredSelectedIndex
            }
        }

        const switchTab = (offset: number) => {
            activeTabIndex = (activeTabIndex + offset + tabs.length) % tabs.length
            filterRows()
        }
        const moveSelection = (offset: number) => {
            selectedIndex = Math.max(0, Math.min(selectedIndex + offset, filteredRows.length - 1))
        }
        const cycleAction = () => {
            const row = filteredRows[selectedIndex]

            if (!row) {
                return
            }

            const actionOrder: SessionAction[] =
                row.kind === 'skipped' ? ['keep', 'delete'] : ['delete', 'archive', 'keep']
            const current = actions.get(row.session.path) ?? 'keep'
            const next = actionOrder[(actionOrder.indexOf(current) + 1) % actionOrder.length]

            actions.set(row.session.path, next)
        }
        const renderHeader = (width: number): string[] => {
            const leftText = theme.bold('Session Snap')
            const separator = theme.fg('muted', ' | ')
            const rightText = truncateToWidth(
                tabs
                    .map((tab) => {
                        const label =
                            tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)
                        const text = `${tab === activeTab() ? '◉' : '○'} ${label} ${
                            rowsByTab[tab].length
                        }`

                        return theme.fg(tab === activeTab() ? 'accent' : 'muted', text)
                    })
                    .join(separator),
                width,
                '',
            )
            const availableLeft = Math.max(0, width - visibleWidth(rightText) - 1)
            const left = truncateToWidth(leftText, availableLeft, '')
            const spacing = Math.max(0, width - visibleWidth(left) - visibleWidth(rightText))
            const hintSeparator = theme.fg('muted', ' · ')
            const searchHints =
                keyHint('tui.input.tab', 'scope') +
                hintSeparator +
                theme.fg('muted', 're:<pattern> regex · "phrase" exact')
            const actionHints = [
                keyHint('tui.select.confirm', 'action'),
                rawKeyHint('ctrl+enter', 'apply visible'),
            ].join(hintSeparator)

            return [
                `${left}${' '.repeat(spacing)}${rightText}`,
                truncateToWidth(searchHints, width, '…'),
                truncateToWidth(actionHints, width, '…'),
            ]
        }
        const renderList = (width: number): string[] => {
            const lines = [...searchInput.render(width), '']

            if (filteredRows.length === 0) {
                lines.push(theme.fg('muted', '  No sessions found'))
                return lines
            }

            const startIndex = Math.max(
                0,
                Math.min(
                    selectedIndex - Math.floor(visibleRows / 2),
                    filteredRows.length - visibleRows,
                ),
            )
            const endIndex = Math.min(startIndex + visibleRows, filteredRows.length)

            for (let index = startIndex; index < endIndex; index += 1) {
                const row = filteredRows[index]
                const selected = index === selectedIndex
                const cursor = selected ? theme.fg('accent', '› ') : '  '
                const project =
                    row.kind === 'session'
                        ? projectName(row.session.cwd, row.session.projectDirectory)
                        : cleanDisplayText(row.session.projectDirectory)
                const title =
                    row.kind === 'session'
                        ? sessionTitle(row.session)
                        : `${cleanDisplayText(row.session.reason)} — ${cleanDisplayText(
                              basename(row.session.path),
                          )}`
                const action = actions.get(row.session.path) ?? 'keep'
                const color = (rgb: readonly [number, number, number], text: string) =>
                    snapColor(rgb, theme.getColorMode() === 'truecolor', text)
                const styleAction = (text: string) => color(SNAP_COLORS[action], text)
                const prefix =
                    cursor +
                    styleAction('▌') +
                    ' ' +
                    styleAction(theme.bold(action.toUpperCase().padEnd(7))) +
                    ' ' +
                    color(SNAP_COLORS.metadata, '│') +
                    ' '
                const projectBadge = truncatePlainText(`[${project}]`, projectColumnWidth)
                const projectPadding = ' '.repeat(projectColumnWidth - visibleWidth(projectBadge))
                const stats =
                    row.kind === 'session'
                        ? `${String(row.session.messageCount).padStart(
                              countColumnWidth,
                          )} ${formatSessionDate(row.session.lastActivityAt).padStart(
                              ageColumnWidth,
                          )}`
                        : ' '.repeat(countColumnWidth + 1 + ageColumnWidth)
                const rightText =
                    projectPadding +
                    color(SNAP_COLORS.project, theme.bold(projectBadge)) +
                    ' ' +
                    color(SNAP_COLORS.metadata, stats)
                const titleWidth = Math.max(
                    0,
                    width - visibleWidth(prefix) - visibleWidth(rightText) - 1,
                )
                const shownTitle = truncatePlainText(title, titleWidth)
                let styledTitle =
                    row.kind === 'session' && row.session.name
                        ? theme.fg('warning', shownTitle)
                        : shownTitle

                if (selected) {
                    styledTitle = theme.bold(styledTitle)
                }

                const left = prefix + styledTitle
                const spacing = Math.max(1, width - visibleWidth(left) - visibleWidth(rightText))
                let line = truncateToWidth(left + ' '.repeat(spacing) + rightText, width)

                if (selected) {
                    line = theme.bg('selectedBg', line)
                }

                lines.push(line)
            }

            if (startIndex > 0 || endIndex < filteredRows.length) {
                lines.push(
                    theme.fg(
                        'muted',
                        truncateToWidth(
                            `  (${selectedIndex + 1}/${filteredRows.length})`,
                            width,
                            '',
                        ),
                    ),
                )
            }

            return lines
        }
        const header = { render: renderHeader, invalidate: () => {} }
        const list = { render: renderList, invalidate: () => {} }

        container.addChild(new Spacer(1))
        container.addChild(new DynamicBorder((text) => theme.fg('accent', text)))
        container.addChild(new Spacer(1))
        container.addChild(header)
        container.addChild(new Spacer(1))
        container.addChild(list)
        container.addChild(new Spacer(1))
        container.addChild(new DynamicBorder((text) => theme.fg('accent', text)))

        return {
            get focused() {
                return focused
            },
            set focused(value: boolean) {
                focused = value
                searchInput.focused = value
            },
            render: (width) => container.render(width),
            invalidate: () => container.invalidate(),
            handleInput: (data) => {
                if (
                    matchesKey(data, 'ctrl+enter') ||
                    // Windows Terminal sends Ctrl+Enter as the same LF byte as Ctrl+J.
                    (Boolean(process.env.WT_SESSION) && matchesKey(data, 'ctrl+j'))
                ) {
                    const hasDestructiveActions = filteredRows.some((row) => {
                        const action = actions.get(row.session.path)

                        return action === 'delete' || action === 'archive'
                    })

                    if (!hasDestructiveActions) {
                        ctx.ui.notify(
                            'No destructive actions in the current tab and filter',
                            'info',
                        )
                        return
                    }

                    done({
                        actions: new Map(actions),
                        scope: new Set(filteredRows.map((row) => row.session.path)),
                        tab: activeTab(),
                        filter: searchInput.getValue(),
                        selectedPath: filteredRows[selectedIndex]?.session.path,
                    })
                    return
                }

                if (matchesKey(data, 'shift+tab')) {
                    switchTab(-1)
                } else if (keybindings.matches(data, 'tui.input.tab')) {
                    switchTab(1)
                } else if (keybindings.matches(data, 'tui.select.pageUp')) {
                    moveSelection(-visibleRows)
                } else if (keybindings.matches(data, 'tui.select.pageDown')) {
                    moveSelection(visibleRows)
                } else if (keybindings.matches(data, 'tui.select.up')) {
                    moveSelection(-1)
                } else if (keybindings.matches(data, 'tui.select.down')) {
                    moveSelection(1)
                } else if (keybindings.matches(data, 'tui.select.confirm')) {
                    cycleAction()
                } else if (keybindings.matches(data, 'tui.select.cancel')) {
                    done(null)
                    return
                } else {
                    searchInput.handleInput(data)
                    filterRows()
                }

                tui.requestRender()
            },
        }
    })
}

/** Execute reviewed deletes first and archives second, isolating file failures. */
async function executeActions(
    sessions: CleanupTarget[],
    actions: Map<string, SessionAction>,
    ctx: ExtensionCommandContext,
): Promise<ExecutionResult> {
    const selected = [
        ...sessions.filter((session) => actions.get(session.path) === 'delete'),
        ...sessions.filter((session) => actions.get(session.path) === 'archive'),
    ]
    const result: ExecutionResult = { deleted: [], archived: [], failures: [] }

    try {
        for (let index = 0; index < selected.length; index += 1) {
            const session = selected[index]
            const action = actions.get(session.path)

            ctx.ui.setStatus(
                'session-snap',
                `${action === 'delete' ? 'Deleting' : 'Archiving'} ${index + 1}/${selected.length}`,
            )

            try {
                if (action === 'delete') {
                    await deleteSession(session.path)
                    result.deleted.push(session.path)
                } else if ('fileSizeBytes' in session) {
                    await archiveSession(session)
                    result.archived.push(session.path)
                } else {
                    throw new Error('Skipped sessions cannot be archived')
                }
            } catch (error) {
                result.failures.push({
                    session,
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        }
    } finally {
        ctx.ui.setStatus('session-snap', undefined)
    }

    return result
}

/** Scan, review, confirm, and execute one Session Snap cleanup run. */
async function handleSnap(ctx: ExtensionCommandContext): Promise<void> {
    if (ctx.mode !== 'tui') {
        ctx.ui.notify('/snap is only available in the interactive TUI', 'warning')
        return
    }

    const config = loadConfig()
    const currentSessionFile = ctx.sessionManager.getSessionFile()
    const scanResult = await ctx.ui.custom<ScanResult | { error: string } | null>(
        (tui, theme, _keybindings, done) => {
            const loader = new BorderedLoader(tui, theme, 'Scanning Pi sessions...')

            loader.onAbort = () => done(null)

            scanSessions(config, currentSessionFile, loader.signal)
                .then((result) => {
                    if (!loader.signal.aborted) {
                        done(result)
                    }
                })
                .catch((error) => {
                    if (!loader.signal.aborted) {
                        done({ error: error instanceof Error ? error.message : String(error) })
                    }
                })

            return loader
        },
    )

    if (scanResult === null) {
        ctx.ui.notify('Session scan cancelled', 'info')
        return
    }

    if ('error' in scanResult) {
        ctx.ui.notify(`Could not scan sessions: ${cleanDisplayText(scanResult.error)}`, 'error')
        return
    }

    if (scanResult.sessions.length === 0 && scanResult.skipped.length === 0) {
        ctx.ui.notify('No sessions found', 'info')
        return
    }

    const actions = new Map<string, SessionAction>([
        ...scanResult.sessions.map((session) => [session.path, session.action] as const),
        ...scanResult.skipped.map((session) => [session.path, 'keep'] as const),
    ])
    let view: ReviewViewState | undefined

    while (scanResult.sessions.length > 0 || scanResult.skipped.length > 0) {
        let review: ReviewResult | null

        try {
            review = await reviewCandidates(ctx, scanResult, actions, view)
        } catch (error) {
            ctx.ui.notify(
                `Could not open Session Snap review: ${cleanDisplayText(
                    error instanceof Error ? error.message : String(error),
                )}`,
                'error',
            )
            return
        }

        if (!review) {
            return
        }

        view = {
            tab: review.tab,
            filter: review.filter,
            selectedPath: review.selectedPath,
        }

        const selected: CleanupTarget[] = [
            ...scanResult.sessions.filter((session) => {
                const action = review.actions.get(session.path)

                return (
                    review.scope.has(session.path) && (action === 'delete' || action === 'archive')
                )
            }),
            ...scanResult.skipped.filter(
                (session) =>
                    review.scope.has(session.path) && review.actions.get(session.path) === 'delete',
            ),
        ]

        if (selected.length === 0) {
            continue
        }

        const deleting = selected.filter((session) => review.actions.get(session.path) === 'delete')
        const archiving = selected.filter(
            (session): session is ClassifiedSession =>
                'fileSizeBytes' in session && review.actions.get(session.path) === 'archive',
        )
        const deletingSize = deleting.every((session) => 'fileSizeBytes' in session)
            ? ` (${formatBytes(
                  deleting.reduce(
                      (total, session) =>
                          total + ('fileSizeBytes' in session ? session.fileSizeBytes : 0),
                      0,
                  ),
              )})`
            : ''
        const tabName = review.tab.charAt(0).toUpperCase() + review.tab.slice(1)
        const filter = cleanDisplayText(review.filter)
        const scope =
            `Scope: ${tabName} tab • ${review.scope.size} visible session${
                review.scope.size === 1 ? '' : 's'
            }` + (filter ? ` • filter: ${truncateToWidth(filter, 60, '…')}` : '')
        const confirmation = [
            scope,
            `Delete ${deleting.length} sessions${deletingSize}`,
            `Archive ${archiving.length} sessions (${formatBytes(
                archiving.reduce((total, session) => total + session.fileSizeBytes, 0),
            )})`,
        ]

        if (!(await ctx.ui.confirm('Execute Session Snap?', confirmation.join('\n')))) {
            ctx.ui.notify('Session cleanup cancelled', 'info')
            continue
        }

        const execution = await executeActions(selected, review.actions, ctx)
        const completed = new Set([...execution.deleted, ...execution.archived])

        scanResult.sessions = scanResult.sessions.filter((session) => !completed.has(session.path))
        scanResult.skipped = scanResult.skipped.filter((session) => !completed.has(session.path))

        for (const path of completed) {
            actions.delete(path)
        }

        const summary =
            `Deleted ${execution.deleted.length} sessions, ` +
            `archived ${execution.archived.length} sessions`

        ctx.ui.notify(summary, execution.failures.length ? 'warning' : 'info')

        if (execution.failures.length > 0) {
            const failures = execution.failures
                .slice(0, 5)
                .map(
                    ({ session, error }) =>
                        `${cleanDisplayText(session.projectDirectory)}/${cleanDisplayText(
                            basename(session.path),
                        )}: ${cleanDisplayText(error)}`,
                )
            const remaining = execution.failures.length - failures.length

            if (remaining > 0) {
                failures.push(`and ${remaining} more`)
            }

            ctx.ui.notify(failures.join('\n'), 'warning')
        }
    }
}

// -----------------------------------------------------------------------------
// Extension entry point
// -----------------------------------------------------------------------------

/** Register the Session Snap command. */
export default function (pi: ExtensionAPI) {
    pi.registerCommand('snap', {
        description: 'Review and clean up trivial or old Pi sessions',
        handler: async (_args, ctx) => {
            await handleSnap(ctx)
        },
    })
}
