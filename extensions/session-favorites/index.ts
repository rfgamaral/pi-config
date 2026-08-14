import {
    getAgentDir,
    SessionManager,
    SessionSelectorComponent,
    type ExtensionAPI,
    type ExtensionCommandContext,
    type ExtensionContext,
    type SessionInfo,
} from '@earendil-works/pi-coding-agent'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Root directory for Pi's local session files. */
const SESSIONS_ROOT = join(getAgentDir(), 'sessions')

/** Root directory for empty favorite marker files. */
const FAVORITES_ROOT = join(getAgentDir(), 'favorites')

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Progress callback used by Pi's session selector. */
type ProgressCallback = (loaded: number, total: number) => void

/** A favorite marker resolved to its local session file. */
type ResolvedFavorite = {
    sessionId: string
    sessionPath: string
}

/** Validated location details for the current session. */
type CurrentSessionLocation = {
    projectDirectory: string
    sessionFile: string
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

/** Return true for a safe, extensionless Pi session ID marker name. */
function isMarkerName(name: string): boolean {
    return /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/.test(name)
}

/** Derive and validate a session's project directory relative to the sessions root. */
function getRelativeProjectDirectory(sessionFile: string): string {
    const projectDirectory = relative(SESSIONS_ROOT, dirname(sessionFile))

    if (
        !projectDirectory ||
        isAbsolute(projectDirectory) ||
        projectDirectory === '..' ||
        projectDirectory.startsWith(`..${sep}`)
    ) {
        throw new Error("Current session is outside Pi's standard sessions directory")
    }

    return projectDirectory
}

/** Build a marker path from a relative project directory and session ID. */
function getMarkerPath(projectDirectory: string, sessionId: string): string {
    if (!isMarkerName(sessionId)) {
        throw new Error('Current session has an unsupported session ID')
    }

    return join(FAVORITES_ROOT, projectDirectory, sessionId)
}

/** Resolve and validate the current session's local path. */
function getCurrentSessionLocation(ctx: ExtensionContext): CurrentSessionLocation {
    const sessionFile = ctx.sessionManager.getSessionFile()

    if (!sessionFile) {
        throw new Error('Current session has no local session path')
    }

    return {
        projectDirectory: getRelativeProjectDirectory(sessionFile),
        sessionFile,
    }
}

/** Resolve the current persisted session's favorite marker path. */
async function getCurrentMarkerPath(ctx: ExtensionContext): Promise<string> {
    const { projectDirectory, sessionFile } = getCurrentSessionLocation(ctx)

    try {
        const sessionStats = await stat(sessionFile)

        if (!sessionStats.isFile()) {
            throw new Error('Current session path is not a file')
        }
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            throw new Error('Current session is not persisted yet')
        }

        throw error
    }

    return getMarkerPath(projectDirectory, ctx.sessionManager.getSessionId())
}

/** Read a directory, treating a missing directory as empty. */
async function readDirectory(path: string) {
    try {
        return await readdir(path, { withFileTypes: true })
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            return []
        }

        throw error
    }
}

/** Remove a marker that resolved earlier in this picker invocation. */
async function removeStaleMarker(markerPath: string, resolvedMarkers: Set<string>): Promise<void> {
    if (!resolvedMarkers.has(markerPath)) {
        return
    }

    try {
        await unlink(markerPath)
    } catch (error) {
        if (getErrorCode(error) !== 'ENOENT') {
            throw error
        }
    }

    resolvedMarkers.delete(markerPath)
}

/** Resolve one mirrored favorite project directory to local session files. */
async function resolveProjectFavorites(
    projectDirectory: string,
    resolvedMarkers: Set<string>,
): Promise<ResolvedFavorite[]> {
    const markerDirectory = join(FAVORITES_ROOT, projectDirectory)
    const sessionDirectory = join(SESSIONS_ROOT, projectDirectory)
    const markerEntries = await readDirectory(markerDirectory)
    const sessionEntries = await readDirectory(sessionDirectory)
    const markerIds = markerEntries
        .filter((entry) => entry.isFile() && isMarkerName(entry.name))
        .map((entry) => entry.name)
    const favorites: ResolvedFavorite[] = []

    for (const sessionId of markerIds) {
        const markerPath = join(markerDirectory, sessionId)
        const sessionFile = sessionEntries.find(
            (entry) => entry.isFile() && entry.name.endsWith(`_${sessionId}.jsonl`),
        )?.name

        if (!sessionFile) {
            await removeStaleMarker(markerPath, resolvedMarkers)
            continue
        }

        resolvedMarkers.add(markerPath)
        favorites.push({
            sessionId,
            sessionPath: join(sessionDirectory, sessionFile),
        })
    }

    return favorites
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

/** Read one favorite session file into Pi's session-picker metadata shape. */
async function buildSessionInfo(filePath: string): Promise<SessionInfo | null> {
    try {
        const fileStats = await stat(filePath)
        let header: Record<string, unknown> | null = null
        let messageCount = 0
        let firstMessage = ''
        const allMessages: string[] = []
        let name: string | undefined
        let lastActivityTime: number | undefined
        const lines = createInterface({
            input: createReadStream(filePath, { encoding: 'utf8' }),
            crlfDelay: Infinity,
        })

        for await (const line of lines) {
            const entry = parseEntry(line)

            if (!entry) {
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
            }

            if (entry.type !== 'message') {
                continue
            }

            messageCount += 1

            if (typeof entry.message !== 'object' || entry.message === null) {
                continue
            }

            const message = entry.message as Record<string, unknown>

            if (message.role !== 'user' && message.role !== 'assistant') {
                continue
            }

            const messageTime =
                typeof message.timestamp === 'number'
                    ? message.timestamp
                    : typeof entry.timestamp === 'string'
                      ? new Date(entry.timestamp).getTime()
                      : Number.NaN

            if (Number.isFinite(messageTime)) {
                lastActivityTime = Math.max(lastActivityTime ?? 0, messageTime)
            }

            const text = extractText(message.content)

            if (!text) {
                continue
            }

            allMessages.push(text)

            if (!firstMessage && message.role === 'user') {
                firstMessage = text
            }
        }

        if (!header) {
            return null
        }

        const headerTimestamp = typeof header.timestamp === 'string' ? header.timestamp : ''
        const headerTime = new Date(headerTimestamp).getTime()
        const modified =
            typeof lastActivityTime === 'number' && lastActivityTime > 0
                ? new Date(lastActivityTime)
                : Number.isFinite(headerTime)
                  ? new Date(headerTime)
                  : fileStats.mtime

        return {
            path: filePath,
            id: header.id as string,
            cwd: typeof header.cwd === 'string' ? header.cwd : '',
            name,
            parentSessionPath:
                typeof header.parentSession === 'string' ? header.parentSession : undefined,
            created: new Date(headerTimestamp),
            modified,
            messageCount,
            firstMessage: firstMessage || '(no messages)',
            allMessagesText: allMessages.join(' '),
        }
    } catch {
        return null
    }
}

/** Scan resolved favorite files and report progress to Pi's session selector. */
async function loadResolvedFavorites(
    favorites: ResolvedFavorite[],
    onProgress?: ProgressCallback,
): Promise<SessionInfo[]> {
    const sessions: SessionInfo[] = []
    let loaded = 0

    for (const favorite of favorites) {
        const session = await buildSessionInfo(favorite.sessionPath)

        if (session?.id === favorite.sessionId) {
            sessions.push(session)
        }

        loaded += 1
        onProgress?.(loaded, favorites.length)
    }

    sessions.sort((left, right) => right.modified.getTime() - left.modified.getTime())
    return sessions
}

/** Load favorites for the current session's project directory. */
async function loadCurrentFavorites(
    projectDirectory: string,
    resolvedMarkers: Set<string>,
    onProgress?: ProgressCallback,
): Promise<SessionInfo[]> {
    const favorites = await resolveProjectFavorites(projectDirectory, resolvedMarkers)

    return loadResolvedFavorites(favorites, onProgress)
}

/** Load favorites across every mirrored project directory. */
async function loadAllFavorites(
    resolvedMarkers: Set<string>,
    onProgress?: ProgressCallback,
): Promise<SessionInfo[]> {
    const projectEntries = await readDirectory(FAVORITES_ROOT)
    const favorites: ResolvedFavorite[] = []

    for (const entry of projectEntries) {
        if (entry.isDirectory()) {
            favorites.push(...(await resolveProjectFavorites(entry.name, resolvedMarkers)))
        }
    }

    return loadResolvedFavorites(favorites, onProgress)
}

// -----------------------------------------------------------------------------
// Main functions
// -----------------------------------------------------------------------------

/** Add the current session's empty favorite marker. */
async function handleFavorite(ctx: ExtensionCommandContext): Promise<void> {
    try {
        const markerPath = await getCurrentMarkerPath(ctx)

        await mkdir(dirname(markerPath), { recursive: true })

        try {
            await writeFile(markerPath, '', { flag: 'wx' })
        } catch (error) {
            if (getErrorCode(error) === 'EEXIST') {
                ctx.ui.notify('Already in favorites', 'info')
                return
            }

            throw error
        }

        ctx.ui.notify('Added to favorites', 'info')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Could not add to favorites: ${message}`, 'error')
    }
}

/** Remove the current session's favorite marker. */
async function handleUnfavorite(ctx: ExtensionCommandContext): Promise<void> {
    try {
        const markerPath = await getCurrentMarkerPath(ctx)

        try {
            await unlink(markerPath)
        } catch (error) {
            if (getErrorCode(error) === 'ENOENT') {
                ctx.ui.notify('Not in favorites', 'info')
                return
            }

            throw error
        }

        ctx.ui.notify('Removed from favorites', 'info')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Could not remove from favorites: ${message}`, 'error')
    }
}

/** Open Pi's session selector with favorite-only loaders. */
async function handleFavorites(ctx: ExtensionCommandContext): Promise<void> {
    if (ctx.mode !== 'tui') {
        ctx.ui.notify('/favorites is only available in the interactive TUI', 'warning')
        return
    }

    let location: CurrentSessionLocation

    try {
        location = getCurrentSessionLocation(ctx)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.notify(`Could not open favorites: ${message}`, 'error')
        return
    }

    const resolvedMarkers = new Set<string>()
    const selectedPath = await ctx.ui.custom<string | undefined>(
        (tui, _theme, keybindings, done) =>
            new SessionSelectorComponent(
                (onProgress) =>
                    loadCurrentFavorites(location.projectDirectory, resolvedMarkers, onProgress),
                (onProgress) => loadAllFavorites(resolvedMarkers, onProgress),
                (sessionPath) => done(sessionPath),
                () => done(undefined),
                () => ctx.shutdown(),
                () => tui.requestRender(),
                {
                    renameSession: async (sessionFilePath, nextName) => {
                        const next = (nextName ?? '').trim()

                        if (!next) {
                            return
                        }

                        const manager = SessionManager.open(sessionFilePath)
                        manager.appendSessionInfo(next)
                    },
                    showRenameHint: true,
                    keybindings,
                },
                location.sessionFile,
            ),
    )

    if (!selectedPath) {
        return
    }

    await ctx.switchSession(selectedPath)
}

// -----------------------------------------------------------------------------
// Extension entry point
// -----------------------------------------------------------------------------

/** Register the Session Favorites commands. */
export default function (pi: ExtensionAPI) {
    pi.registerCommand('favorite', {
        description: 'Add the current session to favorites',
        handler: async (_args, ctx) => {
            await handleFavorite(ctx)
        },
    })

    pi.registerCommand('unfavorite', {
        description: 'Remove the current session from favorites',
        handler: async (_args, ctx) => {
            await handleUnfavorite(ctx)
        },
    })

    pi.registerCommand('favorites', {
        description: 'Resume a favorite session',
        handler: async (_args, ctx) => {
            await handleFavorites(ctx)
        },
    })
}
