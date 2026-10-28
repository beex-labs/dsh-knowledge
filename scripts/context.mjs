#!/usr/bin/env node
// Host hooks use different envelopes. Only documented context channels emit text.
import { existsSync, lstatSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SECTION, POINTER, findProjectRoot, refuseScope, resolveScope, readKnowledgeBase, composeReminder, initPrompt } from '../lib/knowledge.mjs'

const EMPTY = '本项目尚无共享知识库 `.dsh/`。需要建立时用 knowledge 技能或明确请求建立知识库，由模型阅读真实代码生成 overview.md、architecture.md 和 features/*.md；未经用户要求不要创建空知识库。'
const EVENT_NAMES = { sessionStart: 'SessionStart', sessionEnd: 'SessionEnd', postToolUse: 'PostToolUse', postToolUseFailure: 'PostToolUseFailure', preToolUse: 'PreToolUse', preCompact: 'PreCompact', subagentStart: 'SubagentStart', userPromptTransformed: 'UserPromptTransformed' }
const INVALIDATE = new Set(['PreCompact', 'PostCompact', 'PostCompaction', 'PreCompress'])
const INJECT = new Set(['UserPromptSubmit', 'BeforeAgent', 'SessionStart', 'SubagentStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'AfterTool', 'UserPromptTransformed', 'UserPromptExpansion', 'CwdChanged', 'FileChanged'])
const TOOLS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'AfterTool', 'FileChanged'])
const stateDirectory = () => join(process.env.PLUGIN_DATA || tmpdir(), 'dsh-knowledge-state-v2')
const statePath = (event, root, agent) => {
  const session = event.session_id ?? event.sessionId ?? event.conversation_id ?? event.trajectory_id ?? event.transcript_path
  if (!session) return undefined
  const key = createHash('sha256').update(JSON.stringify([agent, root, session, event.agent_id ?? event.subagent_id])).digest('hex')
  return join(stateDirectory(), `${key}.json`)
}
const readState = (path) => { try { return path ? JSON.parse(readFileSync(path, 'utf8')) : {} } catch { return {} } }
function saveState(path, state) {
  if (!path) return
  try {
    mkdirSync(stateDirectory(), { recursive: true })
    if (lstatSync(stateDirectory()).isSymbolicLink()) return
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) return
    writeFileSync(path, JSON.stringify(state), { mode: 0o600 })
  } catch { /* Cache failure only repeats context. */ }
}

function envelope(agent, name, text, event) {
  if (agent === 'copilot') {
    if (name === 'UserPromptTransformed') {
      if (typeof event.transformedPrompt !== 'string') return undefined
      return { modifiedTransformedPrompt: `${event.transformedPrompt}\n\n${text}` }
    }
    return { additionalContext: text }
  }
  if (agent === 'cursor') return { additional_context: text }
  if (agent === 'kimi') return text
  return { hookSpecificOutput: { hookEventName: name, additionalContext: text } }
}

/** A native file-write hook must not follow a symlink out of the shared knowledge directory. */
function knowledgeWriteError(event, root) {
  const tool = event.tool_name ?? event.toolName ?? event.tool?.name ?? ''
  if (!/write|edit|replace|patch|create/i.test(tool)) return undefined
  const input = event.tool_input ?? event.toolInput ?? event.arguments ?? {}
  const candidate = input.file_path ?? input.filePath ?? input.path ?? input.target_file ?? input.targetFile
  if (typeof candidate !== 'string') return undefined
  const target = resolve(root, candidate)
  const knowledge = join(root, '.dsh')
  const rel = relative(knowledge, target)
  if (rel === '..' || rel.startsWith(`..${sep}`) || /^[A-Za-z]:/.test(rel)) return undefined
  let current = target
  for (;;) {
    try { if (lstatSync(current).isSymbolicLink()) return '共享知识库路径包含符号链接或 junction，不能通过该路径写入项目外文件。请在真实项目根 .dsh/ 内增量编辑。' } catch { /* New files have no entry yet. */ }
    if (current === knowledge || current === root) break
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  return undefined
}

export async function handleEvent(event, agent = 'claude', forcedName) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return undefined
  const rawName = forcedName ?? event.hook_event_name ?? event.hookEventName ?? event.hook_type
  const name = EVENT_NAMES[rawName] ?? rawName
  if (!INJECT.has(name) && !INVALIDATE.has(name) && name !== 'SessionEnd') return undefined
  const hint = event.cwd ?? event.workspace_roots?.[0] ?? event.workspaceRoots?.[0] ?? process.env.DEVIN_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR ?? process.env.GEMINI_PROJECT_DIR ?? process.cwd()
  if (typeof hint !== 'string' || !existsSync(hint)) return undefined
  const root = findProjectRoot(hint)
  if (refuseScope(root)) return agent === 'cursor' && name === 'PreToolUse' ? { permission: 'allow' } : undefined
  const stateFile = statePath(event, root, agent)
  if (name === 'SessionEnd') {
    if (stateFile) rmSync(stateFile, { force: true })
    return undefined
  }
  const state = readState(stateFile)
  if (INVALIDATE.has(name)) {
    delete state.fingerprint
    saveState(stateFile, state)
    return undefined
  }
  if (name === 'PreToolUse') {
    const error = knowledgeWriteError(event, root)
    if (error) {
      if (agent === 'cursor') return { permission: 'deny', user_message: error, agent_message: error }
      if (agent === 'devin') return { decision: 'block', reason: error }
      return { hookSpecificOutput: { hookEventName: name, permissionDecision: 'deny', permissionDecisionReason: error } }
    }
    if (agent === 'cursor') return { permission: 'allow' }
  }
  // Qwen prompt can contain an internal tool-continuation expansion. Only the original submission can authorize init.
  const original = agent === 'qwen' ? event.submitted_prompt : event.prompt
  const command = /^\s*\/(?:dsh-knowledge:)?knowledge(?:[ \t]+([^\r\n]*))?\s*$/.exec(typeof original === 'string' ? original : '')
  let text
  if (command && ['UserPromptSubmit', 'BeforeAgent', 'UserPromptExpansion'].includes(name)) {
    const scope = resolveScope(hint, command[1])
    text = scope.error ? `知识库请求无法执行：${scope.error}` : initPrompt({ ...scope, hasKnowledgeBase: (await readKnowledgeBase(root)).exists })
  } else {
    const knowledge = await readKnowledgeBase(root)
    if (TOOLS.has(name) && state.fingerprint === knowledge.fingerprint) return undefined
    if (TOOLS.has(name) && !knowledge.exists) return undefined
    text = !knowledge.exists ? EMPTY : state.fingerprint === knowledge.fingerprint && !['SessionStart', 'SubagentStart', 'CwdChanged'].includes(name)
      ? POINTER
      : `${SECTION}\n\n${composeReminder({ ...knowledge, scope: '.' })}`
    if (text.length > 9800) text = `${text.slice(0, 9400)}\n（上下文已截断，请读取 .dsh/overview.md 与相关文档。）`
    state.fingerprint = knowledge.fingerprint
    saveState(stateFile, state)
  }
  return envelope(agent, name, text, event)
}

async function main() {
  const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
  const agent = option('--agent') ?? 'claude'
  let input = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    input += chunk
    if (input.length > 1024 * 1024) return
  }
  const result = await handleEvent(JSON.parse(input), agent, option('--event'))
  if (result) process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const timeout = setTimeout(() => process.exit(0), 5000)
  try { await main() } catch { /* Invalid payloads and optional IO failures stay silent. */ }
  clearTimeout(timeout)
}
