/**
 * DSH project knowledge system.
 *
 * This plugin does not analyse code. It hands the job to the model, which is
 * the only thing in the system that can actually understand a codebase, and
 * then feeds the resulting documents back into later turns.
 *
 * It contributes three things:
 *
 *   1. `/init [path]` — admits one user message asking the model to explore the
 *      project and write `.dsh` documents. The command itself only writes the
 *      prompt; the model does the reading and the writing with its own tools.
 *   2. A prompt section stating the standing contract for `.dsh`.
 *   3. An `agent/pre-step` listener that injects the knowledge base's overview,
 *      a document listing, and the rule that the model decides for itself
 *      whether its change made those documents stale.
 *
 * The knowledge base always lives at the project root, in one `.dsh` directory,
 * regardless of which subdirectory a request was scoped to.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { DSH_DIR, SECTION, POINTER, findProjectRoot, resolveScope, readKnowledgeBase, initPrompt, composeReminder } from './lib/knowledge.mjs'
export * from './lib/knowledge.mjs'

export const name = 'dsh-knowledge'
export const inject = ['commands', 'systemPrompt']

/**
 * Build the immutable user-role message the platform's inbox expects.
 *
 * The session log validates every message it accepts: an identified `id`, the
 * exact role, a `source` object with a non-empty `kind`, and an array of content
 * blocks. Constructing it here rather than importing a helper keeps this plugin
 * free of a runtime dependency on a specific DSH package, which a profile plugin
 * cannot resolve from its own directory.
 * @param {object} input - message input.
 * @param {string} input.text - message text.
 * @param {string} input.kind - source kind, namespaced to this plugin.
 * @param {object} [input.meta] - extra source fields, JSON-serializable.
 * @returns {object} a frozen user message.
 */
export function createMessage(input) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text: input.text })]),
    source: Object.freeze({ kind: input.kind, ...(input.meta ?? {}) }),
  })
}

/**
 * @param {object} ctx - the Cordis plugin context.
 */
export function apply(ctx) {
  const logger = ctx.logger ?? console

  /** Per-session state: the reminder already injected, keyed by knowledge-base fingerprint. */
  const sessions = new Map()
  const stateFor = (sessionId) => {
    let state = sessions.get(sessionId)
    if (state === undefined) {
      state = { injected: undefined, pendingInit: undefined }
      sessions.set(sessionId, state)
    }
    return state
  }

  /**
   * Resolve this plugin's prompt-section order.
   *
   * `getSectionOrder` returns undefined for a name the platform does not own, and
   * `section()` rejects a non-finite order by throwing — which would abort the
   * whole plugin registration. So an unknown name falls back to a fixed slot
   * rather than propagating undefined.
   * @returns {number} the section order.
   */
  const sectionOrder = () => {
    const base = ctx.systemPrompt.getSectionOrder?.('TOOL_READ')
    return Number.isFinite(base) ? base - 10 : 1090
  }

  // ------------------------------------------------------------------- /init
  for (const commandName of ['init', 'knowledge']) ctx.effect(() => ctx.commands.register({
    name: commandName,
    description: '建立或更新 DSH 项目知识库（.dsh）：让 AI 阅读代码并把理解写成文档',
    input: { hint: '[路径] — 路径留空则针对整个项目' },
    async handler(invocation) {
      const agent = invocation.agent
      if (agent === undefined) {
        return { kind: 'error', text: `/${commandName} 需要一个活动会话来执行。` }
      }
      const cwd = agent.session?.header?.cwd ?? process.cwd()
      const { projectRoot, readRoot, scope, error } = resolveScope(cwd, invocation.rawInput)
      if (error !== undefined) return { kind: 'error', text: error }

      const dshDir = join(projectRoot, DSH_DIR)
      const hasKnowledgeBase = existsSync(join(dshDir, 'overview.md'))
      const state = stateFor(agent.id)

      // The instruction is injected through `agent/pre-step` rather than posted,
      // so the transcript shows the short command line the user typed instead of
      // a wall of prompt text. What is admitted here is only that line — and
      // admitting it is what wakes the driver, which is why any of this runs.
      state.pendingInit = initPrompt({ projectRoot, readRoot, scope, hasKnowledgeBase })

      const followup = agent.followup ?? agent.steer
      if (typeof followup !== 'function') {
        state.pendingInit = undefined
        return {
          kind: 'error',
          text: '当前运行时不支持从命令启动模型回合（Agent 缺少 followup/steer）。无法让 AI 执行索引。',
        }
      }
      try {
        followup.call(agent, createMessage({ text: `/${commandName}${String(invocation.rawInput ?? '')}`, kind: 'user' }))
      } catch (error) {
        state.pendingInit = undefined
        logger.warn?.(`dsh-knowledge: /init could not start a turn: ${error instanceof Error ? error.message : String(error)}`)
        return {
          kind: 'error',
          text: `无法启动 AI 回合：${error instanceof Error ? error.message : String(error)}`,
        }
      }

      return {
        kind: 'success',
        text: [
          hasKnowledgeBase ? '已请求 AI 更新知识库。' : '已请求 AI 建立知识库。',
          '',
          `- 读取范围：\`${scope}\`（${readRoot}）`,
          `- 文档位置：\`${dshDir}\``,
          '',
          'AI 现在会自己阅读代码并写入文档，进度直接显示在对话中。',
        ].join('\n'),
      }
    },
  }), `dsh-knowledge: /${commandName} command`)

  // -------------------------------------------------------- prompt section
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'dsh-knowledge',
    // Placed just ahead of the read tool's own section, so the knowledge-base
    // rules are read before the file tools they refer to.
    order: sectionOrder(),
    text: SECTION,
  }), 'dsh-knowledge: prompt section')

  // ------------------------------------------------------- context injection
  /**
   * Inject the knowledge base before each turn's first step.
   *
   * `agent/pre-step` is the platform's documented per-turn hook: a waterfall that
   * may replace the messages entering the step. This listener runs the rest of
   * the chain first and then appends, so it composes with other prompt
   * contributors instead of fighting them.
   */
  ctx.on('agent/pre-step', async ({ agent, step }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    // Only the first step of a turn carries injected context; later steps in the
    // same turn already have it in their history.
    if (step !== 1) return decision

    if (agent === undefined) return decision
    const state = stateFor(agent.id)
    const additions = []

    // A `/init` that is waiting to be delivered. It replaces the ordinary
    // reminder for this turn: the model is about to read the whole project, so
    // reciting the existing knowledge base first would only add noise.
    if (state.pendingInit !== undefined) {
      const text = state.pendingInit
      state.pendingInit = undefined
      return { ...decision, messages: [...decision.messages, createMessage({ text, kind: 'dsh-knowledge', meta: { form: 'init' } })] }
    }

    const cwd = agent.session?.header?.cwd
    if (cwd === undefined) return decision
    try {
      const projectRoot = findProjectRoot(cwd)
      const { exists, documents, overview, fingerprint } = await readKnowledgeBase(projectRoot)
      if (!exists) return decision
      if (state.injected === fingerprint) {
        return { ...decision, messages: [...decision.messages, createMessage({ text: POINTER, kind: 'dsh-knowledge', meta: { form: 'project-pointer' } })] }
      }
      state.injected = fingerprint

      const scope = relative(projectRoot, cwd).split(sep).join('/') || '.'
      additions.push(createMessage({
        text: composeReminder({ overview, documents, scope }),
        kind: 'dsh-knowledge',
        meta: { form: 'project-context', documents: documents.length },
      }))
    } catch (error) {
      // Injection is an optimisation. A failure here must never break the turn.
      logger.warn?.(`dsh-knowledge: context injection failed: ${error instanceof Error ? error.message : String(error)}`)
      return decision
    }
    return { ...decision, messages: [...decision.messages, ...additions] }
  })

  /**
   * Drop an undelivered `/init` when its turn ends.
   *
   * The prompt is delivered by `agent/pre-step`, which does not run if the turn
   * is cancelled first. Without this the stale instruction would surface in the
   * next, unrelated turn. `agent/turn-stopping` is the platform's end-of-turn
   * hook and its signal is still live, which is the right window to clean up.
   */
  ctx.on('agent/turn-stopping', ({ agent }) => {
    const state = sessions.get(agent.id)
    if (state !== undefined) state.pendingInit = undefined
  })

  ctx.effect(() => () => sessions.clear(), 'dsh-knowledge: session state')
}
