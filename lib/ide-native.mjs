import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { knowledgeCommand, quotedProgram } from './ide-capabilities.mjs'

// Events without a model-context output are used only to invalidate local state.
export const IDE_NATIVE_HOOK_PROFILES = {
  cursor: { path: '.cursor/hooks.json', style: 'flat', timeout: 10, events: ['sessionStart', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'preCompact', 'sessionEnd'] },
  qoder: { path: '.qoder/settings.json', style: 'grouped', timeout: 10, events: ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'PreToolUse', 'PreCompact', 'SessionEnd'] },
  'qoder-cli': { path: '.qoder/settings.json', style: 'grouped', timeout: 10, events: ['SessionStart', 'UserPromptSubmit', 'SubagentStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'PostCompact', 'CwdChanged', 'FileChanged', 'SessionEnd'] },
  devin: { path: '.devin/hooks.v1.json', style: 'event-map', timeout: 10, events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostCompaction', 'SessionEnd'] },
}

function hookConfig(profile, { packageRoot, executable, selectedAgents = [] }) {
  const definition = IDE_NATIVE_HOOK_PROFILES[profile]
  const base = `${quotedProgram(executable)} ${quotedProgram(join(packageRoot, 'scripts/context.mjs'))} --agent ${profile}`
  // Devin reads Claude's hooks by default. Its distinct compaction event still
  // needs a native listener, but do not install the same context hooks twice.
  const inheritedClaude = profile === 'devin' && selectedAgents.includes('claude-code')
  const events = inheritedClaude ? ['PostCompaction'] : definition.events
  const hooks = {}
  for (const event of events) {
    const handler = { type: 'command', command: `${base} --event ${event} --dsh-knowledge-managed`, timeout: definition.timeout }
    hooks[event] = definition.style === 'flat'
      ? [handler]
      : [{ ...(event.includes('ToolUse') ? { matcher: '.*' } : {}), hooks: [handler] }]
  }
  return definition.style === 'flat' ? { version: 1, hooks } : definition.style === 'event-map' ? hooks : { hooks }
}

function clinePlugin({ project, packageRoot }) {
  const core = pathToFileURL(join(packageRoot, 'lib/knowledge.mjs')).href
  return `// Cline SDK/CLI plugin; the VS Code and JetBrains extension use the skill.
import { SECTION, POINTER, findProjectRoot, refuseScope, readKnowledgeBase, composeReminder } from ${JSON.stringify(core)}

let directory = ${JSON.stringify(project)}
const managedKind = 'dsh-knowledge-context'
const writesFiles = (context) => /write|edit|replace|patch|delete|move|rename/i.test(context?.toolCall?.name ?? context?.tool?.name ?? '')

async function contextText() {
  try {
    const root = findProjectRoot(directory)
    if (refuseScope(root)) return undefined
    const knowledge = await readKnowledgeBase(root)
    const text = knowledge.exists
      ? SECTION + '\\n\\n' + composeReminder({ ...knowledge, scope: '.' })
      : POINTER + '\\n当前没有 .dsh/；仅在用户明确要求建立时使用 knowledge 技能。'
    return text.length > 9800 ? text.slice(0, 9400) + '\\n详情请读取项目根 .dsh/overview.md 和相关文档。' : text
  } catch { return undefined }
}

export default {
  name: 'dsh-knowledge',
  manifest: { capabilities: ['hooks'] },
  setup(_api, context) {
    if (typeof context?.cwd === 'string') directory = context.cwd
  },
  hooks: {
    async beforeRun() {
      const text = await contextText()
      return text ? { appendContext: text } : undefined
    },
    async beforeModel({ request } = {}) {
      if (!Array.isArray(request?.messages)) return undefined
      const text = await contextText()
      if (!text) return undefined
      // Keep every original message and multimodal part intact. Only replace
      // this plugin's prior synthetic message, if the host retained it.
      const messages = request.messages.filter((message) => message?.metadata?.kind !== managedKind)
      const createdAt = Date.now()
      return { messages: [...messages, { id: 'dsh-knowledge-' + createdAt, role: 'user', createdAt, metadata: { kind: managedKind }, content: [{ type: 'text', text }] }] }
    },
    beforeTool(context) {
      return writesFiles(context) ? { appendContext: POINTER } : undefined
    },
    afterTool(context) {
      return writesFiles(context) ? { appendContext: POINTER } : undefined
    },
  },
}
`
}

export function ideNativeFiles(id, options) {
  const { skill, selectedAgents = [] } = options
  const files = []
  const bundledSkill = (path) => files.push({ path, kind: 'command', format: 'skill', body: skill })
  const command = (path, frontmatter = 'description: 建立或增量更新共享 .dsh 项目知识库\nargument-hint: "[path]"') => files.push({ path, kind: 'command', format: 'markdown', body: knowledgeCommand(skill, undefined, frontmatter) })

  if (id === 'cursor') bundledSkill('.cursor/skills/knowledge/SKILL.md')
  if (id === 'windsurf') {
    for (const directory of ['.windsurf', '.devin']) {
      command(`${directory}/workflows/knowledge.md`, 'description: 建立或增量更新共享 .dsh 项目知识库')
      bundledSkill(`${directory}/skills/knowledge/SKILL.md`)
    }
  }
  if (id === 'cline') {
    bundledSkill('.cline/skills/knowledge/SKILL.md')
    // Cline's documented file discovery scans .js/.ts, not .mjs.
    files.push({ path: '.cline/plugins/dsh-knowledge.js', kind: 'command', format: 'javascript', body: clinePlugin(options) })
  }
  if (id === 'roo') {
    command('.roo/commands/knowledge.md')
    bundledSkill('.roo/skills/knowledge/SKILL.md')
  }
  if (id === 'trae') {
    command('.trae/commands/knowledge.md', 'name: knowledge\ndescription: 建立或增量更新共享 .dsh 项目知识库')
    bundledSkill('.trae/skills/knowledge/SKILL.md')
  }
  if (id === 'qoder' || id === 'qoder-cli') {
    command('.qoder/commands/knowledge.md', 'name: knowledge\ndescription: 建立或增量更新共享 .dsh 项目知识库')
    bundledSkill('.qoder/skills/knowledge/SKILL.md')
  }
  if (id === 'devin') bundledSkill('.agents/skills/knowledge/SKILL.md')

  // Both Qoder products read the same settings. Use the richer profile once
  // when both are selected; the IDE ignores events it does not implement.
  if (IDE_NATIVE_HOOK_PROFILES[id] && !(id === 'qoder' && selectedAgents.includes('qoder-cli'))) {
    files.push({ path: IDE_NATIVE_HOOK_PROFILES[id].path, kind: 'json-hooks', hookProfile: id, body: JSON.stringify(hookConfig(id, options), null, 2) })
  }
  return files
}
