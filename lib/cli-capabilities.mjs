/** Native CLI definitions. This module describes files; the installer owns all I/O. */
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const TAG = '--dsh-knowledge-managed'
const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const command = (path, body, format = 'markdown') => ({ path, kind: 'command', format, body })
const grouped = (events, handler) => Object.fromEntries(events.map((event) => [event, [{ hooks: [handler(event)] }]]))
const WRITE_TOOLS = 'Write|Edit|MultiEdit|apply_patch|write_file|edit_file|replace|run_shell_command|Bash'

export const CLI_HOOK_PROFILES = {
  codex: {
    path: '.codex/hooks.json', shape: 'grouped', output: 'hookSpecificOutput.additionalContext',
    contextEvents: ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'PreToolUse', 'PostToolUse'],
    cleanupEvents: ['SessionEnd'],
    sources: ['https://learn.chatgpt.com/docs/hooks'],
    note: 'Project layer and exact hook definitions require native trust review; /hooks reviews them. Never bypass trust.',
  },
  copilot: {
    path: '.github/hooks/dsh-knowledge.json', shape: 'flat', output: 'additionalContext / modifiedTransformedPrompt',
    contextEvents: ['sessionStart', 'userPromptTransformed', 'subagentStart', 'postToolUse'],
    cleanupEvents: ['sessionEnd'],
    sources: ['https://docs.github.com/en/copilot/reference/hooks-reference'],
    note: 'CLI command userPromptSubmitted output is ignored. userPromptTransformed must append to, and preserve, transformedPrompt.',
  },
  gemini: {
    path: '.gemini/settings.json', shape: 'grouped', output: 'hookSpecificOutput.additionalContext',
    contextEvents: ['SessionStart', 'BeforeAgent', 'AfterTool'], cleanupEvents: ['PreCompress', 'SessionEnd'],
    sources: ['https://geminicli.com/docs/hooks/reference/'],
    note: 'BeforeAgent context is per turn. PreCompress is observation-only; it can clear the cache but cannot inject context.',
  },
  qwen: {
    path: '.qwen/settings.json', shape: 'grouped', output: 'hookSpecificOutput.additionalContext',
    contextEvents: ['SessionStart', 'UserPromptSubmit', 'UserPromptExpansion', 'SubagentStart', 'PreToolUse', 'PostToolUse', 'PostToolBatch'],
    cleanupEvents: ['PostCompact', 'SessionEnd'],
    sources: ['https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/'],
    note: 'UserPromptSubmit.prompt may be a continuation. Only submitted_prompt proves a user submission. PostCompact output is ignored.',
  },
  kimi: {
    path: null, shape: 'plugin-rules', output: 'plain text', contextEvents: ['UserPromptSubmit'], cleanupEvents: ['PostCompact', 'SessionEnd'],
    sources: ['https://moonshotai.github.io/kimi-code/en/customization/hooks', 'https://moonshotai.github.io/kimi-code/en/customization/plugins.html'],
    note: 'Native plugin installation is currently per user. Project skills work directly; the canonical repository plugin still requires /plugins install.',
  },
}

export const CLI_COMMANDS = {
  codex: { invocation: '/skills → knowledge, or $knowledge [scope]', sources: ['https://learn.chatgpt.com/docs/build-skills'] },
  copilot: { invocation: '/knowledge [scope]', sources: ['https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference', 'https://code.visualstudio.com/docs/agent-customization/prompt-files'] },
  gemini: { invocation: '/knowledge [scope]', sources: ['https://geminicli.com/docs/cli/custom-commands/'] },
  qwen: { invocation: '/knowledge [scope]', sources: ['https://qwenlm.github.io/qwen-code-docs/en/users/features/commands/', 'https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/'] },
  kimi: { invocation: '/skill:knowledge [scope]; plugin: /dsh-knowledge:knowledge [scope]', sources: ['https://moonshotai.github.io/kimi-code/en/reference/slash-commands.html', 'https://moonshotai.github.io/kimi-code/en/customization/plugins.html'] },
  amp: { invocation: 'Ctrl+O → knowledge; or ask to use the knowledge skill', sources: ['https://ampcode.com/docs/customize/plugins', 'https://ampcode.com/docs/customize/skills', 'https://ampcode.com/docs/plugin-api'] },
  aider: { invocation: '/load .aider/commands/knowledge.txt; /load .aider/commands/context.txt', sources: ['https://aider.chat/docs/usage/commands', 'https://raw.githubusercontent.com/Aider-AI/aider/main/aider/commands.py'] },
}

function quoted(path) {
  if (typeof path !== 'string' || /["\r\n$`!&|<>^%]/.test(path)) throw new Error('Native hook path contains unsupported shell characters')
  return `"${path.replace(/\\/g, '/')}"`
}

function hookCommand(profile, event, options) {
  return `${quoted(options.executable)} ${quoted(join(options.packageRoot, 'scripts/context.mjs'))} --agent ${profile}${event ? ` --event ${event}` : ''} ${TAG}`
}

function hookFiles(profile, options) {
  const definition = CLI_HOOK_PROFILES[profile]
  const events = [...definition.contextEvents, ...definition.cleanupEvents]
  let hooks
  if (profile === 'copilot') {
    hooks = Object.fromEntries(events.map((event) => {
      const invocation = hookCommand(profile, event, options)
      return [event, [{ type: 'command', command: invocation, powershell: `& ${invocation}`, timeoutSec: 10,
        ...(event === 'postToolUse' ? { matcher: '^(create|edit|str_replace_editor|apply_patch|bash|powershell)$' } : {}) }]]
    }))
  } else {
    hooks = grouped(events, (event) => ({ type: 'command', command: hookCommand(profile, undefined, options), timeout: profile === 'gemini' ? 10000 : event === 'SessionEnd' ? 3 : 10 }))
    if (hooks.PreToolUse) hooks.PreToolUse[0].matcher = WRITE_TOOLS
    if (hooks.PostToolUse) hooks.PostToolUse[0].matcher = WRITE_TOOLS
    if (hooks.AfterTool) hooks.AfterTool[0].matcher = 'write_file|replace|run_shell_command'
    if (hooks.UserPromptExpansion) hooks.UserPromptExpansion[0].matcher = '^knowledge$'
  }
  return { path: definition.path, kind: 'json-hooks', hookProfile: profile, body: json({ ...(profile === 'copilot' ? { version: 1 } : {}), hooks }) }
}

function skillBody(skill) {
  if (typeof skill !== 'string' || !/^---\r?\n/.test(skill)) throw new Error('Native command generation needs the canonical knowledge skill')
  return skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}

function buildPrompt(skill, argument) {
  return `用户通过本次原生命令明确要求建立或增量更新项目知识库。读取范围：${argument}；未给参数则整个项目。范围必须存在、位于项目内，文档始终写入项目根 .dsh/。\n\n${skillBody(skill)}`
}

function ampPlugin(options) {
  const url = pathToFileURL(join(options.packageRoot, 'lib/knowledge.mjs')).href
  return `import { SECTION, POINTER, findProjectRoot, refuseScope, resolveScope, readKnowledgeBase, composeReminder, initPrompt } from ${JSON.stringify(url)}
const installedProject = ${JSON.stringify(options.project)}
export default function (amp) {
  const projectRoot = () => findProjectRoot(amp.system.workspaceRoot ? amp.helpers.filePathFromURI(amp.system.workspaceRoot) : installedProject)
  amp.on('agent.start', async () => {
    try {
      const root = projectRoot()
      if (refuseScope(root)) return
      const knowledge = await readKnowledgeBase(root)
      const content = SECTION + '\\n\\n' + (knowledge.exists ? composeReminder({ ...knowledge, scope: '.' }) : '知识库尚未建立，只有用户明确要求时才生成项目根 .dsh/ 文档。')
      return { message: { content, display: false } }
    } catch { return }
  })
  amp.on('changes.prompt', () => ({ append: POINTER }))
  amp.registerCommand('knowledge', { title: 'Build or update project knowledge', category: 'knowledge', description: 'Read actual code and maintain the shared project-root .dsh/' }, async (ctx) => {
    if (!ctx.thread) { await ctx.ui.notify('Open a thread before running the knowledge command.'); return }
    const scope = resolveScope(projectRoot(), '')
    if (scope.error) { await ctx.ui.notify(scope.error); return }
    const knowledge = await readKnowledgeBase(scope.projectRoot)
    await ctx.thread.append([{ type: 'user-message', content: initPrompt({ ...scope, hasKnowledgeBase: knowledge.exists }) }])
  })
}
`
}

/** Full native file contents; returned paths are relative to the requested project. */
export function cliCapabilityFiles(id, { project = process.cwd(), packageRoot, executable = process.execPath, skill } = {}) {
  if (!Object.hasOwn(CLI_COMMANDS, id)) return []
  if (typeof packageRoot !== 'string') throw new Error('packageRoot is required for native CLI capabilities')
  const options = { project: resolve(project), packageRoot: resolve(packageRoot), executable, skill }
  const files = []
  if (['codex', 'copilot', 'gemini', 'qwen'].includes(id)) files.push(hookFiles(id, options))
  if (id === 'copilot') files.push(command('.github/prompts/knowledge.prompt.md', `---\nname: knowledge\ndescription: 建立或更新共享 .dsh/ 项目知识库\nagent: agent\n---\n\n${buildPrompt(skill, '用户在本次 /knowledge 后提供的项目内路径')}\n`))
  if (id === 'gemini') files.push(command('.gemini/commands/knowledge.toml', `description = "Build or update the shared .dsh project knowledge"\nprompt = ${JSON.stringify(buildPrompt(skill, '{{args}}'))}\n`, 'toml'))
  if (id === 'qwen') files.push(command('.qwen/commands/knowledge.md', `---\ndescription: 建立或更新共享 .dsh/ 项目知识库\n---\n\n${buildPrompt(skill, '{{args}}')}\n`))
  if (id === 'amp') files.push(command('.amp/plugins/dsh-knowledge.js', ampPlugin(options), 'javascript'))
  if (id === 'aider') {
    files.push(command('.aider/knowledge.md', `${skillBody(skill)}\n`))
    files.push(command('.aider/commands/knowledge.txt', `/read-only AGENTS.md\n/read-only .aider/knowledge.md\n/code 用户通过本次 /load 明确要求：阅读真实项目代码，遵守 .aider/knowledge.md，把共享知识库建立或增量更新在项目根 .dsh/，不要生成空模板。\n`, 'text-commands'))
    files.push(command('.aider/commands/context.txt', '/read-only AGENTS.md\n/read-only .dsh/overview.md\n/read-only .dsh/architecture.md\n', 'text-commands'))
  }
  return files
}
