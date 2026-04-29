/**
 * Pure logic extracted from the memory extension for testability.
 * No pi API dependencies — just file I/O and string manipulation.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

// --- Config ---

export interface MemoryConfig {
    memoryDir: string
    memoryFile: string
    scratchpadFile: string
    dailyDir: string
    notesDir: string
    contextFiles: string[]
    searchDirs: string[]
    autocommit: boolean
}

export interface FileConfig {
    dailyDir?: string
    contextFiles?: string[]
    searchDirs?: string[]
    autocommit?: boolean
}

export function loadConfigFile(memoryDir: string): FileConfig {
    try {
        const raw = fs.readFileSync(path.join(memoryDir, '.pi-mem.json'), 'utf-8')
        const parsed = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
        const result: FileConfig = {}
        if (typeof parsed.dailyDir === 'string') result.dailyDir = parsed.dailyDir
        if (Array.isArray(parsed.contextFiles))
            result.contextFiles = parsed.contextFiles.filter((s: unknown) => typeof s === 'string')
        if (Array.isArray(parsed.searchDirs))
            result.searchDirs = parsed.searchDirs.filter((s: unknown) => typeof s === 'string')
        if (typeof parsed.autocommit === 'boolean') result.autocommit = parsed.autocommit
        return result
    } catch {
        return {}
    }
}

function parseCommaSeparated(value: string | undefined): string[] | undefined {
    if (value === undefined) return undefined
    const items = value
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
    return items
}

export function buildConfig(env: Record<string, string | undefined> = process.env): MemoryConfig {
    const memoryDir = env.PI_MEMORY_DIR ?? path.join(env.HOME ?? '~', '.pi', 'agent', 'memory')

    // Load config.json from memory dir (env vars override file values)
    const fileConfig = loadConfigFile(memoryDir)

    const dailyDir = env.PI_DAILY_DIR ?? fileConfig.dailyDir ?? path.join(memoryDir, 'daily')
    const contextFiles = parseCommaSeparated(env.PI_CONTEXT_FILES) ?? fileConfig.contextFiles ?? []
    const searchDirs = parseCommaSeparated(env.PI_SEARCH_DIRS) ?? fileConfig.searchDirs ?? []
    const autocommit =
        env.PI_AUTOCOMMIT !== undefined
            ? env.PI_AUTOCOMMIT === '1' || env.PI_AUTOCOMMIT === 'true'
            : (fileConfig.autocommit ?? false)

    return {
        memoryDir,
        memoryFile: path.join(memoryDir, 'MEMORY.md'),
        scratchpadFile: path.join(memoryDir, 'SCRATCHPAD.md'),
        dailyDir,
        notesDir: path.join(memoryDir, 'notes'),
        contextFiles,
        searchDirs,
        autocommit,
    }
}

// --- Date/time helpers ---

export function todayStr(): string {
    return new Date().toISOString().slice(0, 10)
}

export function yesterdayStr(): string {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
}

export function nowTimestamp(): string {
    return new Date()
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z$/, '')
}

export function shortSessionId(sessionId: string): string {
    return sessionId.slice(0, 8)
}

// --- File helpers ---

export function readFileSafe(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf-8')
    } catch {
        return null
    }
}

export function dailyPath(dailyDir: string, date: string): string {
    return path.join(dailyDir, `${date}.md`)
}

export function ensureDirs(config: MemoryConfig): void {
    fs.mkdirSync(config.memoryDir, { recursive: true })
    fs.mkdirSync(config.dailyDir, { recursive: true })
    fs.mkdirSync(config.notesDir, { recursive: true })
}

// --- Scratchpad ---

export interface ScratchpadItem {
    done: boolean
    text: string
    meta: string
}

export function parseScratchpad(content: string): ScratchpadItem[] {
    const items: ScratchpadItem[] = []
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const match = line.match(/^- \[([ xX])\] (.+)$/)
        if (match) {
            let meta = ''
            if (i > 0 && lines[i - 1].match(/^<!--.*-->$/)) {
                meta = lines[i - 1]
            }
            items.push({
                done: match[1].toLowerCase() === 'x',
                text: match[2],
                meta,
            })
        }
    }
    return items
}

export function serializeScratchpad(items: ScratchpadItem[]): string {
    const lines: string[] = ['# Scratchpad', '']
    for (const item of items) {
        if (item.meta) {
            lines.push(item.meta)
        }
        const checkbox = item.done ? '[x]' : '[ ]'
        lines.push(`- ${checkbox} ${item.text}`)
    }
    return lines.join('\n') + '\n'
}

// --- Memory context builder ---

export function buildMemoryContext(config: MemoryConfig): string {
    ensureDirs(config)
    const sections: string[] = []

    for (const fileName of config.contextFiles) {
        const filePath = path.join(config.memoryDir, fileName)
        const content = readFileSafe(filePath)
        if (content?.trim()) {
            sections.push(`## ${fileName}\n\n${content.trim()}`)
        }
    }

    const longTerm = readFileSafe(config.memoryFile)
    if (longTerm?.trim()) {
        sections.push(`## MEMORY.md (long-term)\n\n${longTerm.trim()}`)
    }

    const today = todayStr()
    const yesterday = yesterdayStr()

    const todayContent = readFileSafe(dailyPath(config.dailyDir, today))
    if (todayContent?.trim()) {
        sections.push(`## Daily log: ${today} (today)\n\n${todayContent.trim()}`)
    }

    const yesterdayContent = readFileSafe(dailyPath(config.dailyDir, yesterday))
    if (yesterdayContent?.trim()) {
        sections.push(`## Daily log: ${yesterday} (yesterday)\n\n${yesterdayContent.trim()}`)
    }

    if (sections.length === 0) {
        return ''
    }

    return `# Memory\n\n${sections.join('\n\n---\n\n')}`
}

export function buildMemoryInstructions(memoryContext: string): string {
    const sections = [
        '\n\n## Memory',
        'The following memory files have been loaded. Use the memory_write tool to persist important information.',
        '- Decisions, preferences, and durable facts → MEMORY.md',
        '- Day-to-day notes and running context → daily/<YYYY-MM-DD>.md',
        '- Things to fix later or keep in mind → scratchpad tool',
        "- Scratchpad is NOT auto-loaded. Use memory_read(target='scratchpad') to fetch it when needed.",
        '- If someone says "remember this," write it immediately.',
        '',
        '### Daily Log Rule',
        "After meaningful interactions, call memory_write(target='daily') with a brief 1-2 sentence summary.",
        '**Log when:** task completed, decision made, bug fixed, new info discovered, config changed.',
        '**Skip when:** greetings, goodbyes, chitchat, simple acks, trivial factual questions.',
        'Log the outcome, not the question (e.g. "Debugged import error — missing __init__.py" not "User asked about imports").',
    ]

    if (memoryContext) {
        sections.push('', memoryContext)
    }

    return sections.join('\n')
}

// --- Session scanner ---

const LOOKBACK_MS = 24 * 60 * 60 * 1000

export interface SessionInfo {
    file: string
    timestamp: string
    title: string
    isChild: boolean
    parentSession?: string
    cwd: string
    cost: number
}

export async function scanSession(filePath: string): Promise<SessionInfo | null> {
    try {
        const cutoffTime = Date.now() - LOOKBACK_MS
        const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
        let lineNum = 0
        let header: any = null
        let title = ''
        let totalCost = 0

        for await (const line of rl) {
            lineNum++
            if (lineNum === 1) {
                try {
                    header = JSON.parse(line)
                } catch {
                    return null
                }
                if (header.timestamp && new Date(header.timestamp).getTime() < cutoffTime) {
                    rl.close()
                    return null
                }
                continue
            }
            try {
                const entry = JSON.parse(line)
                if (entry.type === 'session_info' && entry.name) {
                    title = entry.name
                }
                if (
                    entry.type === 'message' &&
                    entry.message?.role === 'assistant' &&
                    entry.message?.usage?.cost?.total
                ) {
                    totalCost += entry.message.usage.cost.total
                }
            } catch {
                continue
            }
        }

        if (!header?.timestamp) return null

        if (!title) {
            const rl2 = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity })
            for await (const line of rl2) {
                try {
                    const entry = JSON.parse(line)
                    if (entry.type === 'message' && entry.message?.role === 'user') {
                        const content = entry.message.content
                        if (typeof content === 'string') {
                            title = content.slice(0, 80)
                        } else if (Array.isArray(content)) {
                            const textPart = content.find((c: any) => c.type === 'text')
                            if (textPart) title = textPart.text.slice(0, 80)
                        }
                        break
                    }
                } catch {
                    continue
                }
            }
        }

        return {
            file: filePath,
            timestamp: header.timestamp,
            title: title || '(untitled)',
            isChild: !!header.parentSession,
            parentSession: header.parentSession || undefined,
            cwd: header.cwd || '',
            cost: totalCost,
        }
    } catch {
        return null
    }
}

export function isHousekeeping(title: string): boolean {
    const lower = title.toLowerCase()
    const patterns = [
        /^(clear|review|read)\s+(done|scratchpad|today|daily)/,
        /^-\s+(no done|scratchpad|cleared|reviewed|task is)/,
        /^scratchpad\s+(content|management|maintenance|reviewed|items)/,
        /^\(untitled\)$/,
        /^\/\w+$/,
        /^write daily log/,
    ]
    return patterns.some((p) => p.test(lower))
}

// --- Search ---

export interface SearchResult {
    fileMatches: string[]
    lineResults: { file: string; line: number; text: string }[]
}

export function searchMemory(
    config: MemoryConfig,
    query: string,
    maxResults: number = 20,
): SearchResult {
    const needle = query.toLowerCase()
    const fileMatches: string[] = []
    const lineResults: { file: string; line: number; text: string }[] = []

    function searchFile(filePath: string, displayName: string) {
        if (displayName.toLowerCase().includes(needle) && !fileMatches.includes(displayName)) {
            fileMatches.push(displayName)
        }
        const content = readFileSafe(filePath)
        if (!content) return
        const lines = content.split('\n')
        for (let i = 0; i < lines.length && lineResults.length < maxResults; i++) {
            if (lines[i].toLowerCase().includes(needle)) {
                lineResults.push({ file: displayName, line: i + 1, text: lines[i].trimEnd() })
            }
        }
    }

    function searchDir(dir: string, prefix: string) {
        try {
            const files = fs
                .readdirSync(dir)
                .filter((f) => f.endsWith('.md'))
                .sort()
            for (const f of files) {
                if (lineResults.length >= maxResults) break
                searchFile(path.join(dir, f), prefix ? `${prefix}/${f}` : f)
            }
        } catch {}
    }

    searchDir(config.memoryDir, '')
    searchDir(config.dailyDir, 'daily')
    searchDir(config.notesDir, 'notes')

    // Search extra dirs configured via PI_SEARCH_DIRS
    for (const dirName of config.searchDirs) {
        if (lineResults.length >= maxResults) break
        const dirPath = path.join(config.memoryDir, dirName)
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true })
            // Search .md files directly in the dir
            const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md'))
            for (const f of mdFiles) {
                if (lineResults.length >= maxResults) break
                searchFile(path.join(dirPath, f.name), `${dirName}/${f.name}`)
            }
            // Search one level of subdirectories (e.g. catchup/2026-04-20/*.md)
            const subDirs = entries.filter((e) => e.isDirectory())
            for (const sub of subDirs) {
                if (lineResults.length >= maxResults) break
                searchDir(path.join(dirPath, sub.name), `${dirName}/${sub.name}`)
            }
        } catch {}
    }

    return { fileMatches, lineResults }
}
