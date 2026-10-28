/** OpenCode adapter; all knowledge-base policy and I/O live in the shared core. */
import { SECTION, findProjectRoot, refuseScope, resolveScope, readKnowledgeBase, initPrompt, composeReminder as renderReminder } from '../lib/knowledge.mjs'
const id = 'dsh-knowledge'
const HOOKS = ['context', 'compaction', 'generate']

/** Resolve the current worktree, rather than accidentally using its main checkout. */
function knowledgeRoot(client, invocation) {
  const hinted = invocation?.directory ?? client?.location?.directory ?? client?.location?.project?.directory ?? process.cwd()
  return findProjectRoot(hinted)
}

async function sessionRoot(client, invocation) {
  if (invocation?.sessionID && typeof client.session?.get === 'function') {
    const session = await client.session.get({ sessionID: invocation.sessionID })
    const directory = session?.data?.directory ?? session?.directory
    if (typeof directory === 'string' && directory.trim()) return findProjectRoot(directory)
  }
  return knowledgeRoot(client, invocation)
}

async function composeReminder(projectRoot) {
  const knowledge = await readKnowledgeBase(projectRoot)
  if (!knowledge.exists) return `${SECTION}\n\n知识库尚未建立。只有用户运行 /knowledge 后才阅读代码并写文档，不要自行创建空知识库。`
  return renderReminder({ ...knowledge, scope: '.' })
}

/** OpenCode system parts are `{ type: "text", text }`, the same shape as its internal `S0.make`. */
function systemPart(text) {
  return { type: 'text', text }
}

function argumentText(invocation) {
  const text = invocation?.prompt?.text ?? invocation?.arguments ?? invocation?.text
  return text === undefined ? '' : String(text)
}

async function runKnowledge(client, invocation) {
  const root = await sessionRoot(client, invocation)
  const { projectRoot, readRoot, scope, error } = resolveScope(root, argumentText(invocation))
  if (error !== undefined) throw new Error(error)
  const sessionID = invocation?.sessionID ?? invocation?.prompt?.sessionID
  if (sessionID === undefined || sessionID === '') throw new Error('/knowledge 需要一个活动会话。')
  if (typeof client.session?.prompt !== 'function') throw new Error('当前 OpenCode 运行时没有 session.prompt，无法让模型建立知识库。')

  const text = initPrompt({
    projectRoot,
    readRoot,
    scope,
    hasKnowledgeBase: (await readKnowledgeBase(projectRoot)).exists,
  })
  await client.session.prompt({
    ...(invocation.prompt ?? {}),
    sessionID,
    text: `${text}\n知识库不要写入 \`.opencode\`。`,
    ...(invocation.delivery === undefined ? {} : { delivery: invocation.delivery }),
  })
}

async function injectKnowledge(client, ctx) {
  try {
    if (ctx === undefined || ctx === null || !Array.isArray(ctx.system)) return
    const root = await sessionRoot(client, ctx)
    if (refuseScope(root) !== undefined) return
    const text = await composeReminder(root)
    if (text) ctx.system.push(systemPart(text))
  } catch (error) {
    console.warn(`dsh-knowledge: context injection failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function track(disposers, value) {
  if (value && typeof value.dispose === 'function') disposers.push(() => value.dispose())
  else if (typeof value === 'function') disposers.push(value)
}

function createPlugin() {
  return {
    id,
    server: OpenCodeV1,
    async setup(client) {
      const disposers = []
      track(disposers, await client.command.transform((api) => {
        api.add({
          name: 'knowledge',
          description: '建立或更新 .dsh 项目知识库（与 DSH 共用，不写入 .opencode）',
          execute: (invocation) => runKnowledge(client, invocation),
        })
      }))
      for (const event of HOOKS) {
        track(disposers, await client.session.hook(event, (ctx) => injectKnowledge(client, ctx)))
      }
      return async () => {
        await Promise.all(disposers.map((dispose) => dispose()))
      }
    },
  }
}

/** OpenCode 1.18.29+ hook API, paired with the native v2 setup above. */
async function OpenCodeV1({ directory, worktree } = {}) {
  const root = findProjectRoot(directory ?? worktree ?? process.cwd())
  let registered = false
  const currentInit = async (argument) => {
    const scope = resolveScope(root, argument)
    if (scope.error !== undefined) throw new Error(scope.error)
    return `${initPrompt({ ...scope, hasKnowledgeBase: (await readKnowledgeBase(scope.projectRoot)).exists })}\n知识库不要写入 \`.opencode\`。`
  }
  const append = async (output, key) => {
    if (!Array.isArray(output?.[key]) || refuseScope(root) !== undefined) return
    try { output[key].push(await composeReminder(root)) } catch {}
  }
  return {
    async config(config) {
      if (refuseScope(root) !== undefined) return
      config.command ??= {}
      if (config.command.knowledge !== undefined) return
      config.command.knowledge = {
        description: '建立或更新共享 .dsh 项目知识库',
        template: `${await currentInit('')}\n用户指定的读取范围：$ARGUMENTS（留空针对整个项目，文档仍在项目根 .dsh/）。`,
      }
      registered = true
    },
    async 'command.execute.before'(input, output) {
      if (!registered || input.command !== 'knowledge') return
      const text = await currentInit(input.arguments)
      const first = output.parts.find((part) => part.type === 'text')
      if (first !== undefined) first.text = text
    },
    'experimental.chat.system.transform': (_input, output) => append(output, 'system'),
    'experimental.session.compacting': (_input, output) => append(output, 'context'),
  }
}

export default createPlugin()
