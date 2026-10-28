/**
 * The one runnable check for this plugin.
 *
 * It drives the real `apply()` against a fake Cordis context and asserts the
 * behaviours that matter, above all: `/init` must actually start a model turn.
 * That is the exact thing the previous implementation got wrong — it ran a
 * static analyser inside the command handler and never involved the model at
 * all, so the command "succeeded" while doing the wrong job entirely.
 *
 * Usage: node test/plugin.test.mjs
 */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, dirname } from 'node:path'

import { apply, composeReminder, createMessage, findProjectRoot, initPrompt, listDocuments, normalizePathArg, refuseScope, resolveScope } from '../index.js'

let failures = 0
let checks = 0

/** Assert one condition. */
function ok(condition, label) {
  checks += 1
  if (condition) return
  failures += 1
  console.error(`FAIL  ${label}`)
}

/** Assert deep equality on a JSON projection. */
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${label}\n      actual:   ${a}\n      expected: ${b}`)
}

/** Build a fake Cordis context that records what the plugin registers. */
function fakeContext() {
  const registered = { commands: [], sections: [], listeners: new Map() }
  const ctx = {
    logger: { warn() {}, info() {} },
    effect: (fn) => {
      const disposer = fn()
      return () => disposer?.()
    },
    on: (event, handler) => {
      const list = registered.listeners.get(event) ?? []
      list.push(handler)
      registered.listeners.set(event, list)
    },
    commands: { register: (definition) => (registered.commands.push(definition), () => {}) },
    systemPrompt: { section: (section) => (registered.sections.push(section), () => {}), getSectionOrder: () => 100 },
  }
  return { ctx, registered }
}

/** Build a fake agent that records admitted messages. */
function fakeAgent(cwd) {
  const admitted = []
  return {
    id: 'session-test',
    session: { header: { cwd } },
    admitted,
    followup(message) {
      admitted.push(message)
    },
  }
}

/** A throwaway project directory with a marker file. */
async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-test-'))
  await writeFile(join(dir, 'package.json'), '{"name":"fixture"}')
  return dir
}

// ---------------------------------------------------------------------------
// 1. The core contract: /init starts a model turn and writes nothing itself.
// ---------------------------------------------------------------------------
{
  const dir = await makeProject()
  try {
    const { ctx, registered } = fakeContext()
    apply(ctx)
    const init = registered.commands.find((command) => command.name === 'init')
    ok(init !== undefined, '/init registers a command')

    const agent = fakeAgent(dir)
    const result = await init.handler({ agent, rawInput: '', signal: new AbortController().signal })

    ok(result.kind === 'success', '/init reports success')
    eq(agent.admitted.length, 1, '/init admits exactly one model message')
    ok(agent.admitted[0].role === 'user', 'the admitted message is a user message')
    // The transcript must show the command line, not a wall of prompt text.
    eq(agent.admitted[0].content[0].text, '/init', 'the admitted message is the bare command line')
    ok(typeof agent.admitted[0].id === 'string' && agent.admitted[0].id.length > 0, 'the admitted message has an id')
    ok(agent.admitted[0].source.kind === 'user', 'the admitted message is attributed to the user')

    // The instruction itself is injected on the following turn.
    const listener = registered.listeners.get('agent/pre-step')[0]
    const decision = await listener({ agent, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
    eq(decision.messages.length, 1, 'the next turn gains one injected message')
    ok(decision.messages[0].content[0].text.includes('<dsh_init>'), 'the injected message carries the init prompt')

    // ...and only once.
    const replay = await listener({ agent, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
    eq(replay.messages.length, 0, 'the init prompt is delivered only once')

    // The command must not build a knowledge base by itself — that is the
    // model's job, and the previous implementation's core mistake.
    ok(!existsSync(join(dir, '.dsh')), '/init writes no .dsh directory by itself')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 2. A path argument narrows the reading scope but never the write location.
// ---------------------------------------------------------------------------
{
  const dir = await makeProject()
  try {
    await mkdir(join(dir, 'v4', 'backend'), { recursive: true })
    const { ctx, registered } = fakeContext()
    apply(ctx)
    const init = registered.commands.find((command) => command.name === 'init')

    const agent = fakeAgent(join(dir, 'v4'))
    const result = await init.handler({ agent, rawInput: ' backend', signal: new AbortController().signal })

    ok(result.kind === 'success', '/init <path> reports success')
    eq(agent.admitted.length, 1, '/init <path> admits one model message')
    eq(agent.admitted[0].content[0].text, '/init backend', 'the admitted message echoes the command line')

    const listener = registered.listeners.get('agent/pre-step')[0]
    const decision = await listener({ agent, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
    const text = decision.messages[0].content[0].text
    ok(text.includes('backend'), 'the prompt names the requested scope')
    ok(text.includes(join(dir, '.dsh')), 'documents are still written to the project root .dsh')
    ok(!text.includes(join(dir, 'v4', '.dsh')), 'no .dsh is proposed under the scoped directory')

    // The same session scoping from the project root must resolve identically.
    const fromRoot = resolveScope(dir, 'v4/backend')
    eq(fromRoot.scope, 'v4/backend', 'a nested path resolves to a project-relative scope')
    eq(fromRoot.projectRoot, dir, 'the project root is found by ascending to the marker')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 3. Refusals: a knowledge base must never land in the home or DSH config dir.
// ---------------------------------------------------------------------------
{
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const init = registered.commands.find((command) => command.name === 'init')

  const home = process.env.USERPROFILE ?? process.env.HOME
  ok(refuseScope(home) !== undefined, 'the user home directory is refused')
  ok(refuseScope(join(home, '.dsh')) !== undefined, 'the DSH config directory is refused')
  ok(refuseScope(dirname(process.execPath)) === undefined, 'an ordinary directory is allowed')

  // The guard must not depend on DSH_HOME being exported into this process:
  // a plugin's environment is not guaranteed to carry it, and the default
  // location is the one that actually exists on disk.
  const saved = process.env.DSH_HOME
  try {
    delete process.env.DSH_HOME
    ok(refuseScope(join(home, '.dsh')) !== undefined, 'the DSH config directory is refused without DSH_HOME set')
  } finally {
    if (saved !== undefined) process.env.DSH_HOME = saved
  }

  const agent = fakeAgent(home)
  const result = await init.handler({ agent, rawInput: '', signal: new AbortController().signal })
  ok(result.kind === 'error', '/init in the home directory returns an error')
  eq(agent.admitted.length, 0, 'a refused /init admits no model message')

  const missing = await init.handler({ agent: fakeAgent(dirname(process.execPath)), rawInput: 'no-such-dir-xyz', signal: new AbortController().signal })
  ok(missing.kind === 'error', 'a non-existent path returns an error')
  ok(missing.text.includes('no-such-dir-xyz'), 'the error names the path that failed')

  const outside = await init.handler({ agent: fakeAgent(dirname(process.execPath)), rawInput: '..', signal: new AbortController().signal })
  ok(outside.kind === 'error', 'a path outside the project root is refused')
}

// ---------------------------------------------------------------------------
// 3b. Path arguments survive the composer's `@` completion, a leading `.`, and
//     a name that matches the project's own directory.
// ---------------------------------------------------------------------------
{
  const dir = await makeProject()
  try {
    await mkdir(join(dir, 'src', 'lib'), { recursive: true })
    await mkdir(join(dir, 'app'), { recursive: true })

    // The composer's `@` completion inserts literal text; the `@` is decoration.
    eq(normalizePathArg('@src'), 'src', 'a leading @ is stripped')
    eq(normalizePathArg('  @@app  '), 'app', 'repeated @ and padding are stripped')
    eq(normalizePathArg('"plugin dir"'), 'plugin dir', 'a quoted path is unwrapped')
    eq(normalizePathArg(''), '', 'an empty argument stays empty')
    eq(normalizePathArg(undefined), '', 'a missing argument stays empty')

    eq(resolveScope(dir, '@src').scope, 'src', '/init @dir resolves like /init dir')
    eq(resolveScope(dir, 'src/lib').scope, 'src/lib', 'a nested path resolves')
    eq(resolveScope(dir, '.').scope, '.', 'a dot resolves to the project root')

    // `dsh` inside a project named `dsh` means the project, not a child of it.
    const named = resolveScope(dir, basename(dir))
    ok(named.error === undefined, 'the project directory name resolves without error')
    eq(named.scope, '.', 'the project directory name resolves to the project root')

    // A path that only exists relative to the project root still resolves when
    // the session sits in a subdirectory.
    const fromSub = resolveScope(join(dir, 'app'), 'src')
    eq(fromSub.scope, 'src', 'a project-relative path resolves from a subdirectory')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 4. An agent without followup must fail loudly, never silently.
// ---------------------------------------------------------------------------
{
  const dir = await makeProject()
  try {
    const { ctx, registered } = fakeContext()
    apply(ctx)
    const init = registered.commands.find((command) => command.name === 'init')
    const result = await init.handler({ agent: { id: 'x', session: { header: { cwd: dir } } }, rawInput: '', signal: new AbortController().signal })
    ok(result.kind === 'error', 'an agent without followup reports an error instead of pretending success')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 5. Per-turn injection carries the overview, the document list, and the
//    instruction that the model decides for itself whether to update.
// ---------------------------------------------------------------------------
{
  const dir = await makeProject()
  try {
    await mkdir(join(dir, '.dsh', 'features'), { recursive: true })
    await writeFile(join(dir, '.dsh', 'overview.md'), '# Fixture\n\nA project used by the test.')
    await writeFile(join(dir, '.dsh', 'features', 'auth.md'), '# Auth\n')
    await writeFile(join(dir, '.dsh', 'architecture.md'), '# Arch\n')

    const { ctx, registered } = fakeContext()
    apply(ctx)
    const listener = registered.listeners.get('agent/pre-step')[0]
    const agent = fakeAgent(dir)

    const next = async () => ({ kind: 'enter', messages: [] })
    const decision = await listener({ agent, messages: [], step: 1, turn: 1, signal: new AbortController().signal }, next)

    eq(decision.messages.length, 1, 'the first step gains one reminder message')
    const text = decision.messages[0].content[0].text
    ok(text.startsWith('<system-reminder>'), 'the reminder is wrapped as a system reminder')
    ok(text.includes('A project used by the test.'), 'the reminder inlines overview.md')
    ok(text.includes('.dsh/features/auth.md'), 'the reminder lists the feature documents')
    ok(text.includes('.dsh/architecture.md'), 'the reminder lists the architecture document')
    ok(text.includes('由你自己判断'), 'the reminder tells the model to judge staleness itself')
    ok(text.includes('不要动文档'), 'the reminder says an unrelated change needs no document edit')

    // The same unchanged knowledge base must not be restated on the next turn.
    const again = await listener({ agent, messages: [], step: 1, turn: 2, signal: new AbortController().signal }, next)
    eq(again.messages.length, 1, 'an unchanged knowledge base retains a short pointer')
    ok(!again.messages[0].content[0].text.includes('A project used by the test.'), 'the full unchanged overview is not restated')

    // A document edit must re-arm the reminder, since the model may have
    // rewritten the documents during the previous turn.
    await writeFile(join(dir, '.dsh', 'overview.md'), '# Fixture\n\nA project used by the test, now updated.')
    const afterEdit = await listener({ agent, messages: [], step: 1, turn: 3, signal: new AbortController().signal }, next)
    eq(afterEdit.messages.length, 1, 'a changed knowledge base is re-injected')

    // Only the first step of a turn carries it.
    const laterStep = await listener({ agent, messages: [], step: 2, turn: 4, signal: new AbortController().signal }, next)
    eq(laterStep.messages.length, 0, 'later steps in the same turn are left alone')

    // A rejected step stays rejected.
    const rejected = await listener({ agent, messages: [], step: 1, turn: 5, signal: new AbortController().signal }, async () => ({ kind: 'reject' }))
    eq(rejected.kind, 'reject', 'a rejected step is not resurrected')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 6. Injection is inert without a knowledge base, and never throws.
// ---------------------------------------------------------------------------
{
  const dir = await makeProject()
  try {
    const { ctx, registered } = fakeContext()
    apply(ctx)
    const listener = registered.listeners.get('agent/pre-step')[0]
    const agent = fakeAgent(dir)
    const decision = await listener({ agent, messages: [], step: 1, turn: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
    eq(decision.messages.length, 0, 'no knowledge base means no injection')

    // A cwd that does not exist must not break the turn.
    const broken = await listener({ agent: fakeAgent(join(dir, 'gone')), messages: [], step: 1, turn: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [] }))
    eq(broken.messages.length, 0, 'an unreadable cwd injects nothing and does not throw')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 6b. A `/init` whose turn is cancelled before it runs must not leak into the
//     next, unrelated turn.
// ---------------------------------------------------------------------------
{
  const dir = await makeProject()
  try {
    const { ctx, registered } = fakeContext()
    apply(ctx)
    const init = registered.commands.find((command) => command.name === 'init')
    const listener = registered.listeners.get('agent/pre-step')[0]
    const stopper = registered.listeners.get('agent/turn-stopping')[0]
    const agent = fakeAgent(dir)

    await init.handler({ agent, rawInput: '', signal: new AbortController().signal })
    ok(stopper !== undefined, 'a turn-stopping listener is registered')

    // The turn is cancelled before `pre-step` ever runs — the case that produced
    // the stale-prompt bug.
    await stopper({ agent, turn: 1, signal: new AbortController().signal })

    const next = async () => ({ kind: 'enter', messages: [] })
    const decision = await listener({ agent, step: 1 }, next)
    eq(decision.messages.length, 0, 'a cancelled /init does not surface in the next turn')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 7. Document listing and prompt text.
// ---------------------------------------------------------------------------
{
  const dir = await makeProject()
  try {
    const dshDir = join(dir, '.dsh')
    await mkdir(join(dshDir, 'features'), { recursive: true })
    await writeFile(join(dshDir, 'overview.md'), 'x')
    await writeFile(join(dshDir, 'features', 'b.md'), 'x')
    await writeFile(join(dshDir, 'features', 'a.md'), 'x')
    await writeFile(join(dshDir, 'notes.txt'), 'x')

    const documents = await listDocuments(dshDir)
    eq(documents, ['features/a.md', 'features/b.md', 'overview.md'], 'documents are listed recursively, sorted, markdown-only')

    const empty = composeReminder({ overview: undefined, documents: [], scope: '.' })
    ok(empty.includes('/init'), 'an empty knowledge base points at /init')

    const scoped = composeReminder({ overview: 'x', documents: ['overview.md'], scope: 'v4' })
    ok(scoped.includes('v4'), 'a scoped session names its scope')

    const fresh = initPrompt({ projectRoot: 'P', readRoot: 'P', scope: '.', hasKnowledgeBase: false })
    ok(fresh.includes('建立'), 'a fresh project is described as a new knowledge base')
    ok(fresh.includes('不要复制源码片段'), 'the prompt forbids copying source text')
    ok(fresh.includes('功能清单'), 'the prompt asks for a feature table that later edits can register into')
    const update = initPrompt({ projectRoot: 'P', readRoot: 'P', scope: '.', hasKnowledgeBase: true })
    ok(update.includes('更新'), 'an existing project is described as an update')
    ok(update.includes('增量更新'), 'an existing project asks for incremental rather than wholesale rewrites')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 8. Message shape and project-root discovery.
// ---------------------------------------------------------------------------
{
  const message = createMessage({ text: 'hello', kind: 'dsh-knowledge', meta: { a: 1 } })
  ok(Object.isFrozen(message), 'messages are frozen')
  eq(message.role, 'user', 'messages use the user role')
  eq(message.source.kind, 'dsh-knowledge', 'messages carry their source kind')
  eq(message.source.a, 1, 'messages carry extra source metadata')

  const dir = await makeProject()
  try {
    await mkdir(join(dir, 'deep', 'nested'), { recursive: true })
    eq(findProjectRoot(join(dir, 'deep', 'nested')), dir, 'the project root is found by ascending')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 9. The plugin declares only the services it uses, and registers one section.
// ---------------------------------------------------------------------------
{
  const { ctx, registered } = fakeContext()
  apply(ctx)
  eq(registered.sections.length, 1, 'exactly one prompt section is registered')
  ok(registered.sections[0].text.includes('不是比源码更高优先级'), 'the section states the source-of-truth rule')
  ok(registered.listeners.get('agent/pre-step')?.length === 1, 'exactly one pre-step listener is registered')

  // Re-applying must not throw or duplicate global state.
  apply(fakeContext().ctx)
  ok(true, 'applying twice is safe')
}

{
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const listener = registered.listeners.get('agent/pre-step')[0]
  const decision = { kind: 'enter', messages: [] }
  eq(await listener({ agent: { id: 'missing-session' }, step: 1 }, async () => decision), decision, 'an agent without a session does not break the step')
  eq(await listener({ step: 1 }, async () => decision), decision, 'a missing agent does not break the step')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${checks - failures}/${checks} checks`)
process.exit(failures === 0 ? 0 : 1)
