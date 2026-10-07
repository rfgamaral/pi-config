import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { resolve } from 'node:path'

const branchPromptOpening =
    'Generate a title and a git branch name for a coding agent from the user prompt and attachments.\n'
const schemaMarker = '\n\nYou must respond with JSON only that matches this JSON Schema:\n'
const retryMarker = '\n\nPrevious response was invalid with validation errors:'

function isBranchMetadataPrompt(prompt: string): boolean {
    if (!prompt.startsWith(branchPromptOpening)) return false

    const schemaStart = prompt.lastIndexOf(schemaMarker)
    if (schemaStart === -1) return false

    const schemaText = prompt.slice(schemaStart + schemaMarker.length).split(retryMarker)[0]

    try {
        const schema = JSON.parse(schemaText)
        return (
            schema.title === 'BranchName' &&
            schema.type === 'object' &&
            Object.keys(schema.properties ?? {})
                .sort()
                .join(',') === 'branch,title' &&
            schema.properties.branch.type === 'string' &&
            schema.properties.title.type === 'string' &&
            Array.isArray(schema.required) &&
            [...schema.required].sort().join(',') === 'branch,title'
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
            ctx.sessionManager.getSessionFile() !== undefined ||
            !isBranchMetadataPrompt(event.prompt)
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
