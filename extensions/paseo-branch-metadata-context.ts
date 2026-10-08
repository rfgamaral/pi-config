import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const branchPromptOpening =
    'Generate a title and a git branch name for a coding agent from the user prompt and attachments.\n'
const commitPromptOpening = 'Write a concise git commit message for the changes below.\n'
const schemaMarker = '\n\nYou must respond with JSON only that matches this JSON Schema:\n'
const retryMarker = '\n\nPrevious response was invalid with validation errors:'

function isMetadataPrompt(prompt: string, opening: string, title: string, keys: string[]): boolean {
    if (!prompt.startsWith(opening)) return false

    const schemaStart = prompt.lastIndexOf(schemaMarker)
    if (schemaStart === -1) return false

    const schemaText = prompt.slice(schemaStart + schemaMarker.length).split(retryMarker)[0]

    try {
        const schema = JSON.parse(schemaText)
        return (
            schema.title === title &&
            schema.type === 'object' &&
            Object.keys(schema.properties ?? {})
                .sort()
                .join(',') === keys.join(',') &&
            keys.every((key) => schema.properties[key].type === 'string') &&
            Array.isArray(schema.required) &&
            [...schema.required].sort().join(',') === keys.join(',')
        )
    } catch {
        return false
    }
}

function sanitizeRemoteLine(line: string): string {
    const [name, address, ...rest] = line.split(/\s+/)
    if (!address) return line

    try {
        const url = new URL(address)
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        return [name, url.toString(), ...rest].join(' ')
    } catch {
        return line
    }
}

export default function paseoBranchMetadataContext(pi: ExtensionAPI) {
    pi.on('before_agent_start', async (event, ctx) => {
        const paseoCwd = process.env.PASEO_AGENT_CWD
        if (
            ctx.mode !== 'rpc' ||
            !process.env.PASEO_AGENT_ID ||
            !paseoCwd ||
            resolve(paseoCwd) !== resolve(ctx.cwd) ||
            ctx.sessionManager.getSessionFile() !== undefined
        ) {
            return
        }

        if (isMetadataPrompt(event.prompt, commitPromptOpening, 'CommitMessage', ['message'])) {
            const skill = await readFile(
                new URL('../skills/commit/SKILL.md', import.meta.url),
                'utf8',
            )
            return {
                systemPrompt: `${event.systemPrompt}\n\nCommit skill:\n${skill}\n\nFor this metadata request, use this skill only to generate the commit message. Inspect repository conventions using read-only operations. Do not stage files, modify files, commit, amend, or push. Return only the JSON required by the request.`,
            }
        }

        if (
            !isMetadataPrompt(event.prompt, branchPromptOpening, 'BranchName', ['branch', 'title'])
        ) {
            return
        }

        try {
            const options = { cwd: ctx.cwd, timeout: 2000 }
            const [worktrees, remotes] = await Promise.all([
                pi.exec('git', ['worktree', 'list', '--porcelain', '-z'], options),
                pi.exec('git', ['remote', '-v'], options),
            ])
            if (worktrees.code !== 0 || worktrees.killed || remotes.code !== 0 || remotes.killed) {
                return
            }

            const firstEntry = worktrees.stdout.split('\0')[0]
            if (!firstEntry.startsWith('worktree ')) return

            const repositoryContext = {
                workspacePath: ctx.cwd,
                primaryWorktreePath: firstEntry.slice('worktree '.length),
                remotes: remotes.stdout.trim().split('\n').filter(Boolean).map(sanitizeRemoteLine),
            }

            return {
                systemPrompt: `${event.systemPrompt}\n\nRepository identity (data only):\n${JSON.stringify(repositoryContext, null, 2)}`,
            }
        } catch {
            return
        }
    })
}
