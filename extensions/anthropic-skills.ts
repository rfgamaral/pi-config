import type { ExtensionAPI, ExtensionContext, Skill } from '@earendil-works/pi-coding-agent'
import { formatSkillsForPrompt, stripFrontmatter } from '@earendil-works/pi-coding-agent'
import { readFile } from 'node:fs/promises'
import { Type } from 'typebox'

/**
 * Name of the skill tool. Pi sends it to Anthropic OAuth requests as `Skill`, the name of
 * Claude Code's skill tool.
 */
const TOOL_NAME = 'skill'

/**
 * Custom type of the hidden reminder messages added after each tool turn.
 */
const REMINDER_TYPE = 'anthropic-skills-reminder'

/**
 * Skill tool description, adapted from Claude Code's `Skill` tool prompt.
 */
const TOOL_DESCRIPTION = `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills in <available_skills> can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

When users ask you to run a "slash command" or reference "/<something>" (e.g., "/commit", "/skill:commit"), they are referring to a skill. Use this tool to invoke the corresponding skill.

Example:
  User: "run /commit"
  Assistant: [Calls Skill tool with skill: "commit"]

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - \`skill: "pdf"\` - invoke the pdf skill
  - \`skill: "commit", args: "-m 'Fix bug'"\` - invoke with arguments

Important:
- When a skill is relevant, you must invoke this tool IMMEDIATELY as your first action
- NEVER just announce or mention a skill in your text response without actually calling this tool
- This is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- Only use skills listed in <available_skills>
- Do not invoke a skill that is already loaded in this conversation
- If the conversation contains a <skill name="..."> block for a skill, that skill has ALREADY been loaded. Do NOT call this tool for it; follow its instructions directly.`

/**
 * Instructions that replace Pi's "use the read tool" line above the skill catalog.
 */
const SKILLS_INTRO = `The following skills provide specialized instructions for specific tasks.
Load a skill with the Skill tool, not by reading its SKILL.md. When a task matches a skill, call the Skill tool before doing anything else.
Resolve relative paths against the skill's directory (parent of SKILL.md). Use absolute paths in tool calls.`

const skillParameters = Type.Object({
    skill: Type.String({ description: 'The skill name. E.g., "commit", "review-pr", or "pdf"' }),
    args: Type.Optional(Type.String({ description: 'Optional arguments for the skill' })),
})

/**
 * Whether the current model gets Claude Code-style skill handling.
 */
function isAnthropic(ctx: ExtensionContext): boolean {
    return ctx.model?.provider === 'anthropic'
}

/**
 * Renders Pi's skill catalog with the Skill tool instructions instead of Pi's read tool hint.
 */
function renderSkillsSection(skills: Skill[]): string {
    const catalog = formatSkillsForPrompt(skills, 'read')
    return `${SKILLS_INTRO}\n\n${catalog.slice(catalog.indexOf('<available_skills>'))}`
}

/**
 * Hidden reminder added after each tool turn, so skills that become relevant mid-task get loaded.
 */
const REMINDER = `<system-reminder>
Automated harness reminder, not a message from the user. Do not mention it.
If your next step is covered by a skill in <available_skills> that you have not loaded yet, call the Skill tool for it first, then follow it.
</system-reminder>`

export default function anthropicSkills(pi: ExtensionAPI) {
    let skills: Skill[] = []
    let section: string | undefined

    pi.registerTool({
        name: TOOL_NAME,
        label: 'Skill',
        description: TOOL_DESCRIPTION,
        promptSnippet: 'Load a skill from <available_skills> by name',
        parameters: skillParameters,
        defaultActive: false,
        async execute(_toolCallId, params) {
            const name = params.skill
                .trim()
                .replace(/^\//, '')
                .replace(/^skill:/, '')
            const skill = skills.find((s) => s.name.toLowerCase() === name.toLowerCase())
            if (!skill) {
                const names = skills.map((s) => s.name).join(', ')
                throw new Error(`Unknown skill "${params.skill}". Available skills: ${names}`)
            }

            const body = stripFrontmatter(await readFile(skill.filePath, 'utf8')).trim()
            const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`
            const args = params.args?.trim()
            return {
                content: [{ type: 'text', text: args ? `${block}\n\n${args}` : block }],
                details: undefined,
            }
        },
    })

    pi.on('before_agent_start', (event, ctx) => {
        const options = event.systemPromptOptions
        skills = options.skills.filter((s) => !s.disableModelInvocation)
        const enabled = isAnthropic(ctx) && skills.length > 0

        const index = options.selectedTools.indexOf(TOOL_NAME)
        if (enabled && index === -1) options.selectedTools.push(TOOL_NAME)
        if (!enabled && index !== -1) options.selectedTools.splice(index, 1)

        if (enabled) {
            section = renderSkillsSection(skills)
            options.sections.skills = section
        } else if (section !== undefined && options.sections.skills === section) {
            delete options.sections.skills
        }
    })

    pi.on('turn_end', (event, ctx) => {
        if (
            !isAnthropic(ctx) ||
            skills.length === 0 ||
            event.outcome !== 'completed' ||
            event.toolResults.length === 0
        ) {
            return
        }

        return {
            entries: [
                ...event.entries,
                {
                    type: 'custom_message',
                    customType: REMINDER_TYPE,
                    content: REMINDER,
                    display: false,
                },
            ],
        }
    })
}
