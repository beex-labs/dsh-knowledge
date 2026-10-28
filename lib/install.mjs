/** Install small project pointers while preserving user instructions and settings. */
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AGENTS, ALIASES } from './agents.mjs'
import { cliCapabilityFiles } from './cli-capabilities.mjs'
import { ideCapabilityFiles } from './ide-capabilities.mjs'
import { ideNativeFiles } from './ide-native.mjs'
import { SECTION, refuseScope, findProjectRoot } from './knowledge.mjs'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const START = '<!-- dsh-knowledge:start -->'
const END = '<!-- dsh-knowledge:end -->'
const MAX_FILE_BYTES = 2 * 1024 * 1024
const HOOK_TAG = '--dsh-knowledge-managed'
const RULE_FIELDS = {
  cursor: { description: 'Shared DSH project knowledge', alwaysApply: 'true' },
  windsurf: { trigger: 'always_on' },
  qoder: { alwaysApply: 'true' },
  trae: { alwaysApply: 'true' },
  codebuddy: { alwaysApply: 'true', enabled: 'true' },
  augment: { type: 'always_apply' },
  continue: { name: 'DSH Knowledge', alwaysApply: 'true' },
}

const BODY = `${SECTION}\n\n先读项目根目录的 \`.dsh/overview.md\` 功能清单，再读相关 \`architecture.md\` 或 \`features/*.md\`，用源码核实。\n\n只有用户明确要求建立或重建知识库时，才使用 knowledge 技能让模型阅读真实代码并生成文档；没有知识库时不要自动创建空 \`.dsh/\`。\n\n改变入口、执行流程、数据流或模块依赖时增量更新对应文档，并同步 overview.md 功能清单；普通 bug 修复和样式修改无需更新。编辑前重读当前文档，保留其他 agent 的改动。文档只描述结构与行为，不复制源码、密钥、token 或连接串。所有 agent 共同读写同一份项目根 \`.dsh/\`。`

function info(path) {
  try { return lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}

/** Check the complete ancestor chain before reading, creating, or replacing files. */
function assertSafePath(path, directory = false) {
  const full = resolve(path)
  const parent = dirname(full)
  if (parent !== full) assertSafePath(parent, true)
  const entry = info(full)
  if (!entry) return
  if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link or junction: ${full}`)
  if (directory ? !entry.isDirectory() : !entry.isFile()) throw new Error(`Expected a ${directory ? 'directory' : 'regular file'}: ${full}`)
}

function targetPath(project, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path)) throw new Error(`Invalid managed path: ${path}`)
  const full = resolve(project, path)
  const rel = relative(project, full)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Managed path escapes the project: ${path}`)
  assertSafePath(full)
  return full
}

function readText(path) {
  const entry = info(path)
  if (!entry) return undefined
  if (entry.size > MAX_FILE_BYTES) throw new Error(`Refusing to modify a file over ${MAX_FILE_BYTES} bytes: ${path}`)
  return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path))
}

/** Replace exactly our bounded section, preserving everything around it. */
function managedText(previous, body, start = START, end = END) {
  if (body.length > 20000) throw new Error('Managed instruction block exceeds its size limit')
  const text = previous ?? ''
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const block = `${start}\n${body.trim().replace(/\r\n/g, '\n')}\n${end}`.replace(/\n/g, newline)
  const starts = text.split(start).length - 1
  const ends = text.split(end).length - 1
  if (starts !== ends || starts > 1) throw new Error('Ambiguous dsh-knowledge managed markers; refusing to replace user content')
  if (!starts) return `${text}${text && !text.endsWith('\n') ? newline : ''}${text ? newline : ''}${block}${newline}`
  const from = text.indexOf(start)
  const to = text.indexOf(end)
  if (to < from || to - from > 24000) throw new Error('Invalid or oversized dsh-knowledge managed block')
  return `${text.slice(0, from)}${block}${text.slice(to + end.length)}`
}

function ruleText(previous, format) {
  const fields = RULE_FIELDS[format]
  let text = previous ?? ''
  if (fields) {
    const newline = text.includes('\r\n') ? '\r\n' : '\n'
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
    let header = frontmatter?.[1] ?? ''
    for (const [key, value] of Object.entries(fields)) {
      const pattern = new RegExp(`^${key}:[^\\r\\n]*`, 'm')
      header = pattern.test(header) ? header.replace(pattern, `${key}: ${value}`) : `${header}${header ? newline : ''}${key}: ${value}`
    }
    text = `---${newline}${header}${newline}---${newline}${frontmatter ? text.slice(frontmatter[0].length) : text}`
  }
  return managedText(text, BODY)
}

function skillText(previous, source) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  if (!header) throw new Error('Bundled knowledge skill has no frontmatter')
  const body = source.slice(header[0].length)
  if (previous && /^---\r?\n/.test(previous)) return managedText(previous, body)
  return `${header[0]}${managedText(previous, body)}`
}

function shellQuoted(path) {
  // A quoted path must stay literal under both POSIX shells and Windows cmd.
  if (/["\r\n$`!&|<>^%]/.test(path)) throw new Error(`Hook path contains unsupported shell characters: ${path}`)
  return `"${path.replace(/\\/g, '/')}"`
}

function mergeHooks(previous, agent) {
  let config
  try { config = previous === undefined ? {} : JSON.parse(previous.replace(/^\uFEFF/, '')) } catch { throw new Error(`Invalid ${agent} settings JSON; no files were changed`) }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${agent} settings must be a JSON object`)
  if (config.hooks === undefined) config.hooks = {}
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new Error(`${agent} settings hooks must be an object`)
  const command = `${shellQuoted(process.execPath)} ${shellQuoted(join(PACKAGE_ROOT, 'scripts/context.mjs'))} --agent ${agent} ${HOOK_TAG}`
  const events = ['UserPromptSubmit', 'SessionStart', 'SessionEnd']
  for (const event of events) {
    if (config.hooks[event] === undefined) config.hooks[event] = []
    const groups = config.hooks[event]
    if (!Array.isArray(groups)) throw new Error(`${agent} hook ${event} must be an array`)
    const cleaned = []
    for (const group of groups) {
      if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) throw new Error(`${agent} hook ${event} must contain grouped hooks`)
      const hooks = group.hooks.filter((hook) => !hook || typeof hook.command !== 'string' || !hook.command.endsWith(` ${HOOK_TAG}`))
      if (hooks.length || group.hooks.length === 0) cleaned.push({ ...group, hooks })
    }
    cleaned.push({ ...(event === 'SessionStart' ? { matcher: 'compact|resume' } : {}), hooks: [{ type: 'command', command, timeout: 10 }] })
    config.hooks[event] = cleaned
  }
  return `${JSON.stringify(config, null, 2)}\n`
}


function managedHook(hook) {
  return !!hook && typeof hook === 'object' && ['command', 'powershell'].some((key) => typeof hook[key] === 'string' && hook[key].includes(HOOK_TAG))
}

function mergeFlatHooks(existing, generated, label) {
  const hooks = existing === undefined ? [] : existing
  if (!Array.isArray(hooks)) throw new Error(`${label} hook entries must be an array`)
  return [...hooks.filter((hook) => !managedHook(hook)), ...generated]
}

function mergeGroupedHooks(existing, generated, label) {
  const groups = existing === undefined ? [] : existing
  if (!Array.isArray(groups)) throw new Error(`${label} hook entries must be an array`)
  const cleaned = []
  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group) || !Array.isArray(group.hooks)) throw new Error(`${label} hook group must contain hooks`)
    const hooks = group.hooks.filter((hook) => !managedHook(hook))
    if (hooks.length || group.hooks.length === 0) cleaned.push({ ...group, hooks })
  }
  return [...cleaned, ...generated]
}

/** Keep user JSON, drop only our previous handlers, then append this installer's handlers. */
function mergeCapabilityHooks(previous, file) {
  if (previous == null || previous.trim() === '' || previous === file.body) return file.body
  let config
  try { config = JSON.parse(previous.replace(/^\uFEFF/, '')) } catch { throw new Error(`Invalid ${file.hookProfile} settings JSON; no files were changed`) }
  const generated = JSON.parse(file.body)
  const label = file.hookProfile
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${label} settings must be a JSON object`)
  if (label === 'devin') {
    for (const [event, groups] of Object.entries(generated)) config[event] = mergeGroupedHooks(config[event], groups, `${label} ${event}`)
  } else {
    if (config.hooks === undefined) config.hooks = {}
    if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new Error(`${label} settings hooks must be an object`)
    const flat = label === 'cursor' || label === 'copilot'
    for (const [event, value] of Object.entries(generated.hooks)) {
      config.hooks[event] = flat ? mergeFlatHooks(config.hooks[event], value, `${label} ${event}`) : mergeGroupedHooks(config.hooks[event], value, `${label} ${event}`)
    }
    if (generated.version !== undefined && config.version === undefined) config.version = generated.version
  }
  const text = JSON.stringify(config, null, 2)
  return file.body.endsWith('\n') ? `${text}\n` : text
}

function replaceGenerated(previous, file) {
  if (previous == null || previous.trim() === '' || previous === file.body) return file.body
  if (previous.includes('dsh-knowledge') || previous.includes('.dsh/')) return file.body
  throw new Error(`Existing ${file.path} is not managed by this installer; refusing to overwrite it`)
}

function renderCapability(previous, file) {
  if (file.kind === 'json-hooks') return mergeCapabilityHooks(previous, file)
  if (file.format === 'skill' || (file.format === 'markdown' && file.path.endsWith('SKILL.md'))) return skillText(previous, file.body)
  return replaceGenerated(previous, file)
}

export function resolveAgents(requested = 'all') {
  if (requested === 'all') return Object.keys(AGENTS)
  const names = Array.isArray(requested) ? requested : String(requested).split(',')
  return [...new Set(names.map((name) => {
    const key = name.trim().toLowerCase()
    const id = ALIASES[key] ?? key
    if (!Object.hasOwn(AGENTS, id)) throw new Error(`Unknown agent: ${name}. Run agents to list supported IDs.`)
    return id
  }))]
}

/** Build every change before mutating disk, including JSON and marker validation. */
export function planInstall({ project = process.cwd(), agent = 'all' } = {}) {
  const requested = resolve(project)
  assertSafePath(requested, true)
  if (!info(requested)?.isDirectory()) throw new Error(`Project directory does not exist: ${requested}`)
  const root = findProjectRoot(requested)
  assertSafePath(root, true)
  if (!info(root)?.isDirectory()) throw new Error(`Project directory does not exist: ${root}`)
  const refusal = refuseScope(root)
  if (refusal) throw new Error(refusal)
  const agents = resolveAgents(agent)
  let source
  const skillSource = () => {
    if (source === undefined) {
      const path = join(PACKAGE_ROOT, 'skills/knowledge/SKILL.md')
      assertSafePath(path)
      source = readText(path)
      if (!source) throw new Error('Bundled knowledge skill is missing')
    }
    return source
  }
  const nativeOptions = { project: root, packageRoot: PACKAGE_ROOT, executable: process.execPath, skill: skillSource(), selectedAgents: agents }
  const changes = new Map()
  const change = (path, render) => {
    const full = targetPath(root, path)
    const previous = changes.has(full) ? changes.get(full).content : readText(full)
    const content = render(previous)
    const original = changes.has(full) ? changes.get(full).previous : previous
    changes.set(full, { path: full, previous: original, content, mode: info(full)?.mode & 0o777 })
  }
  for (const id of agents) {
    const definition = AGENTS[id]
    for (const instruction of definition.instructions) change(instruction.path, (old) => ruleText(old, instruction.format))
    if (definition.skillPath) {
      change(definition.skillPath, (old) => skillText(old, skillSource()))
    }
    if (definition.hook === 'claude') change('.claude/settings.json', (old) => mergeHooks(old, 'claude'))
    if (id === 'opencode') {
      const url = pathToFileURL(join(PACKAGE_ROOT, 'adapters/opencode.js')).href
      change('.opencode/plugins/dsh-knowledge.js', (old) => {
        if (old?.trim() && !old.includes('// dsh-knowledge:start')) throw new Error('Existing OpenCode dsh-knowledge.js is not managed by this installer; refusing to overwrite it')
        return managedText(old, `export { default } from ${JSON.stringify(url)}`, '// dsh-knowledge:start', '// dsh-knowledge:end')
      })
    }
    for (const file of [...cliCapabilityFiles(id, nativeOptions), ...ideCapabilityFiles(id, nativeOptions), ...ideNativeFiles(id, nativeOptions)]) {
      change(file.path, (old) => renderCapability(old, file))
    }
  }
  return { project: root, agents, changes: [...changes.values()].filter((entry) => entry.previous !== entry.content) }
}

function createDirectories(dir) {
  assertSafePath(dir, true)
  if (info(dir)) return
  const parent = dirname(dir)
  if (parent !== dir) createDirectories(parent)
  mkdirSync(dir)
}

export function installProject(options = {}) {
  const plan = planInstall(options)
  if (options.dryRun) return plan
  // Detect edits made while the plan was assembled before replacing any file.
  for (const entry of plan.changes) {
    assertSafePath(entry.path)
    if (readText(entry.path) !== entry.previous) throw new Error(`File changed during installation: ${entry.path}`)
  }
  for (const entry of plan.changes) {
    createDirectories(dirname(entry.path))
    assertSafePath(entry.path)
    const temporary = join(dirname(entry.path), `.dsh-knowledge-${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, entry.content, { encoding: 'utf8', flag: 'wx', mode: entry.mode || 0o644 })
      assertSafePath(entry.path)
      if (readText(entry.path) !== entry.previous) throw new Error(`File changed during installation: ${entry.path}`)
      renameSync(temporary, entry.path)
    } finally { rmSync(temporary, { force: true }) }
  }
  return plan
}
