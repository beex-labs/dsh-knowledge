import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

export const IDE_HOOK_PROFILES = {
  codebuddy: { path: '.codebuddy/settings.json', events: ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'PreToolUse', 'PostToolUse', 'PreCompact', 'SessionEnd'], style: 'grouped', timeout: 10 },
  auggie: { path: '.augment/settings.json', events: ['PreToolUse', 'PostToolUse', 'SessionEnd'], style: 'grouped', timeout: 10000 },
}

export function quotedProgram(path) {
  if (/["\r\n$`!&|<>^%]/.test(path)) throw new Error(`Unsupported hook path: ${path}`)
  return `"${path.replace(/\\/g, '/')}"`
}

export function knowledgeCommand(skill, argument = '命令后用户指定的路径（留空则整个项目）', frontmatter = 'description: 建立或增量更新共享 .dsh 项目知识库\nargument-hint: "[path]"') {
  const body = skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  return `---\n${frontmatter}\n---\n\n用户通过本命令明确要求建立或增量更新共享项目知识库。读取范围：${argument}。先确认路径存在且在真实项目根目录内，禁止越界；文档始终写入项目根 .dsh/。\n\n${body}`
}

export function hookConfiguration(profile, { packageRoot, executable }) {
  const definition = IDE_HOOK_PROFILES[profile]
  const command = `${quotedProgram(executable)} ${quotedProgram(join(packageRoot, 'scripts/context.mjs'))} --agent ${profile}`
  const hooks = {}
  for (const event of definition.events) {
    const handler = { type: 'command', command: `${command} --event ${event} --dsh-knowledge-managed`, timeout: definition.timeout }
    hooks[event] = [{ ...(event.includes('ToolUse') ? { matcher: '.*' } : {}), hooks: [handler] }]
  }
  return JSON.stringify({ hooks }, null, 2)
}

export function ideCapabilityFiles(id, options) {
  const { skill, packageRoot } = options
  const files = []
  const command = (path, argument, frontmatter) => files.push({ path, kind: 'command', format: 'markdown', body: knowledgeCommand(skill, argument, frontmatter) })
  const bundledSkill = (path) => files.push({ path, kind: 'command', format: 'markdown', body: skill })
  if (id === 'codebuddy') {
    command('.codebuddy/commands/knowledge.md', '$ARGUMENTS')
    bundledSkill('.codebuddy/skills/knowledge/SKILL.md')
  }
  if (id === 'auggie') {
    command('.augment/commands/knowledge.md', '$ARGUMENTS')
    bundledSkill('.augment/skills/knowledge/SKILL.md')
  }
  if (id === 'continue') command('.continue/rules/knowledge.md', undefined, 'name: knowledge\ndescription: 建立或增量更新共享 .dsh 项目知识库\ninvokable: true\nalwaysApply: false')
  if (IDE_HOOK_PROFILES[id]) files.push({ path: IDE_HOOK_PROFILES[id].path, kind: 'json-hooks', body: hookConfiguration(id, options), hookProfile: id })
  // Kilo's documented server API shares the OpenCode V1 boundary and core.
  if (id === 'kilo') {
    const url = pathToFileURL(join(packageRoot, 'adapters/opencode.js')).href
    files.push({ path: '.kilo/plugin/dsh-knowledge.js', kind: 'command', format: 'javascript', body: `import adapter from ${JSON.stringify(url)}\nexport default { id: adapter.id, server: adapter.server }\n` })
    command('.kilo/commands/knowledge.md', '$ARGUMENTS', 'description: 建立或增量更新共享 .dsh 项目知识库')
    bundledSkill('.kilo/skills/knowledge/SKILL.md')
  }
  return files
}
