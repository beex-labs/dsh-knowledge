/**
 * Drives the real plugin against a fake OpenCode client.
 * The check that matters: /knowledge starts a model turn and writes nothing itself.
 * Usage: node test/plugin.test.mjs
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import plugin from '../adapters/opencode.js'
import { normalizePathArg, refuseScope, resolveScope } from '../lib/knowledge.mjs'
const createPlugin = () => plugin
const OpenCodeV1 = plugin.server

let failures = 0
let checks = 0

function ok(condition, label) {
  checks += 1
  if (condition) return
  failures += 1
  console.error(`FAIL  ${label}`)
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${label}\n      actual:   ${a}\n      expected: ${b}`)
}

function fakeClient(dir) {
  const hooks = []
  const commands = []
  const prompts = []
  const client = {
    location: { directory: dir, project: { directory: dir, canonical: dir, id: 'fixture' } },
    command: {
      transform(fn) {
        fn({ add(command) { commands.push(command) } })
        return { dispose() {} }
      },
    },
    session: {
      hook(event, fn) {
        hooks.push({ event, fn })
        return { dispose() {} }
      },
      async prompt(input) {
        prompts.push(input)
      },
    },
  }
  return { client, hooks, commands, prompts }
}

async function makeProject() {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-knowledge-'))
  await writeFile(join(dir, 'package.json'), '{"name":"fixture"}')
  return dir
}

{
  const dir = await makeProject()
  try {
    const { client, hooks, commands, prompts } = fakeClient(dir)
    const plugin = createPlugin()
    eq(plugin.id, 'dsh-knowledge', 'plugin id is stable')
    const dispose = await plugin.setup(client)
    ok(typeof dispose === 'function', 'setup returns a disposer')

    const command = commands.find((item) => item.name === 'knowledge')
    ok(command !== undefined, '/knowledge registers a command')
    eq(hooks.map((hook) => hook.event), ['context', 'compaction', 'generate'], 'injects on the three generation hooks')

    await command.execute({ sessionID: 'ses_test', prompt: { text: '' }, delivery: 'queue' })
    eq(prompts.length, 1, '/knowledge starts exactly one model turn')
    ok(prompts[0].text.includes('<dsh_init>'), 'the turn carries the init prompt')
    ok(prompts[0].text.includes(join(dir, '.dsh')), 'documents are addressed to the project-root .dsh')
    ok(prompts[0].text.includes('不要写入 `.opencode`'), 'the prompt forbids .opencode')
    eq(prompts[0].sessionID, 'ses_test', 'the turn stays on the current session')
    eq(prompts[0].delivery, 'queue', 'delivery is passed through')
    ok(!existsSync(join(dir, '.dsh')), '/knowledge writes no .dsh directory by itself')

    const ctx = { system: [], sessionID: 'ses_test' }
    await hooks[0].fn(ctx)
    eq(ctx.system.length, 1, 'a turn gains one system part')
    eq(ctx.system[0].type, 'text', 'the system part matches OpenCode S0.make')
    ok(ctx.system[0].text.includes('.dsh/'), 'the standing reminder names .dsh')
    ok(ctx.system[0].text.includes('尚未建立'), 'an empty project is not told to invent documents')

    await mkdir(join(dir, '.dsh', 'features'), { recursive: true })
    await writeFile(join(dir, '.dsh', 'overview.md'), '这是总览。')
    await writeFile(join(dir, '.dsh', 'features', 'auth.md'), '职责：登录。')
    const again = { system: [{ type: 'text', text: 'existing' }] }
    await hooks[0].fn(again)
    eq(again.system.length, 2, 'injection appends and does not replace existing system parts')
    ok(again.system[1].text.includes('这是总览。'), 'overview is inlined')
    ok(again.system[1].text.includes('.dsh/features/auth.md'), 'feature docs are listed')

    await dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

{
  const dir = await makeProject()
  try {
    await mkdir(join(dir, 'src'), { recursive: true })
    const { client, commands, prompts } = fakeClient(dir)
    await createPlugin().setup(client)
    const command = commands.find((item) => item.name === 'knowledge')
    await command.execute({ sessionID: 'ses_test', prompt: { text: '@src' } })
    ok(prompts[0].text.includes('src/'), 'a path argument narrows the read scope')
    ok(prompts[0].text.includes(join(dir, '.dsh')), 'the write location stays at the project root')
    ok(!prompts[0].text.includes(join(dir, 'src', '.dsh')), 'no .dsh is proposed under the scoped directory')
    eq(resolveScope(dir, 'src').scope, 'src', 'resolveScope agrees')
    eq(normalizePathArg('@src'), 'src', 'a leading @ is stripped')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

{
  const home = process.env.USERPROFILE ?? process.env.HOME
  ok(refuseScope(home) !== undefined, 'the user home directory is refused')
  ok(refuseScope(join(home, '.dsh')) !== undefined, 'the DSH config directory is refused')
  ok(refuseScope(dirname(process.execPath)) === undefined, 'an ordinary directory is allowed')

  const { client, commands, prompts } = fakeClient(home)
  await createPlugin().setup(client)
  const command = commands.find((item) => item.name === 'knowledge')
  let thrown = false
  try {
    await command.execute({ sessionID: 'ses_test', prompt: { text: '' } })
  } catch (error) {
    thrown = true
    ok(String(error.message).includes('主目录'), 'the refusal names the home directory')
  }
  ok(thrown, '/knowledge in the home directory fails')
  eq(prompts.length, 0, 'a refused command starts no model turn')

  const missing = fakeClient(dirname(process.execPath))
  await createPlugin().setup(missing.client)
  let missingError = ''
  try {
    await missing.commands[0].execute({ sessionID: 'ses_test', prompt: { text: 'no-such-dir-xyz' } })
  } catch (error) {
    missingError = error.message
  }
  ok(missingError.includes('no-such-dir-xyz'), 'a missing path is named in the error')
  eq(missing.prompts.length, 0, 'a missing path starts no model turn')
}

{
  const { client, hooks } = fakeClient(process.cwd())
  await createPlugin().setup(client)
  await hooks[0].fn(undefined)
  await hooks[0].fn({})
  ok(true, 'a hook without a system array does not throw')
}

{
  const dir = await makeProject()
  try {
    await mkdir(join(dir, 'src'))
    const hooks = await OpenCodeV1({ directory: dir })
    const config = { command: { existing: { template: 'keep me' } } }
    await hooks.config(config)
    eq(config.command.existing.template, 'keep me', 'v1 command registration preserves existing commands')
    ok(config.command.knowledge.template.includes('$ARGUMENTS'), 'v1 registers a native command template')
    const attachment = { type: 'file', url: 'file:///fixture.png' }
    const output = { parts: [{ type: 'text', text: 'template' }, attachment] }
    await hooks['command.execute.before']({ command: 'knowledge', arguments: 'src' }, output)
    ok(output.parts[0].text.includes('`src/`'), 'v1 validates and resolves command scope at execution')
    eq(output.parts[1], attachment, 'v1 command keeps attachments')
    let outsideError
    try { await hooks['command.execute.before']({ command: 'knowledge', arguments: '..' }, output) } catch (error) { outsideError = error }
    ok(outsideError instanceof Error, 'v1 refuses a scope outside the project')
    const system = { system: ['existing'] }
    await hooks['experimental.chat.system.transform']({}, system)
    eq(typeof system.system[1], 'string', 'v1 hooks append strings using the official output shape')
    const compact = { context: ['existing'] }
    await hooks['experimental.session.compacting']({}, compact)
    eq(compact.context.length, 2, 'v1 compaction restores the standing knowledge contract')
    const userHooks = await OpenCodeV1({ directory: dir })
    const custom = { command: { knowledge: { template: 'user owned' } } }
    await userHooks.config(custom)
    const userOutput = { parts: [{ type: 'text', text: 'user owned' }] }
    await userHooks['command.execute.before']({ command: 'knowledge', arguments: '' }, userOutput)
    eq(userOutput.parts[0].text, 'user owned', 'v1 leaves a user-owned /knowledge command alone')
  } finally { await rm(dir, { recursive: true, force: true }) }
}

{
  const dir = await makeProject()
  const sessionDir = await makeProject()
  try {
    await mkdir(join(sessionDir, '.dsh'))
    await writeFile(join(sessionDir, '.dsh', 'overview.md'), 'session location content')
    const { client, hooks, commands, prompts } = fakeClient(dir)
    client.session.get = async () => ({ data: { directory: sessionDir } })
    const plugin = createPlugin()
    ok(typeof plugin.server === 'function' && typeof plugin.setup === 'function', 'one default definition supports official v1 and v2 entrypoints')
    await plugin.setup(client)
    const prompt = { text: '', attachments: ['fixture'], model: { providerID: 'test', modelID: 'test' } }
    await commands[0].execute({ sessionID: 'ses_test', prompt, delivery: 'queue' })
    eq(prompts[0].attachments, prompt.attachments, 'v2 preserves prompt attachments')
    eq(prompts[0].model, prompt.model, 'v2 preserves selected model')
    ok(prompts[0].text.includes(join(sessionDir, '.dsh')), 'v2 commands use the session location instead of plugin instance location')
    const output = { system: [], sessionID: 'ses_test' }
    await hooks[0].fn(output)
    ok(output.system[0].text.includes('session location content'), 'v2 hooks read knowledge from the current session location')
  } finally {
    await rm(dir, { recursive: true, force: true })
    await rm(sessionDir, { recursive: true, force: true })
  }
}

if (failures > 0) {
  console.error(`${failures} failed, ${checks - failures} passed, ${checks} total`)
  process.exit(1)
}
console.log(`${checks} passed`)
