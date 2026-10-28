import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const SCRIPT = fileURLToPath(new URL('../scripts/mcp.mjs', import.meta.url))
const wait = (ms) => new Promise((done) => setTimeout(done, ms))

function deadline(promise, ms = 10000) {
  let timer
  return Promise.race([promise, new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('MCP child response timed out')), ms) })]).finally(() => clearTimeout(timer))
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-test-'))
  t.after(async () => {
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}`))
    await rm(root, { recursive: true, force: true })
  })
  await writeFile(join(root, 'package.json'), '{}')
  return root
}

function client(t, root) {
  const child = spawn(process.execPath, [SCRIPT, '--project', root], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const ended = once(child, 'close')
  const pending = new Map()
  const messages = []
  let stderr = ''
  let counter = 0
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
      assert.equal(message.jsonrpc, '2.0')
      assert.ok(Object.hasOwn(message, 'result') !== Object.hasOwn(message, 'error'))
    } catch (error) {
      for (const entry of pending.values()) entry.fail(error)
      return
    }
    messages.push(message)
    const entry = pending.get(message.id)
    if (entry) { pending.delete(message.id); entry.done(message) }
  })
  child.on('error', (error) => { for (const entry of pending.values()) entry.fail(error) })
  const expecting = (id) => deadline(new Promise((done, fail) => pending.set(id, { done, fail })))
  t.after(async () => {
    child.stdin.end()
    let result
    try { result = await deadline(ended, 3000) } catch { child.kill(); result = await deadline(ended) }
    assert.equal(result[0], 0, stderr)
    assert.equal(stderr, '', 'stdout is protocol-only and a healthy server has no stderr output')
  })
  return {
    messages,
    request(method, params) {
      const id = ++counter
      const response = expecting(id)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`)
      return response
    },
    raw(data) {
      const response = expecting(null)
      child.stdin.write(data)
      return response
    },
    notify(method, params) { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`) },
    async splitRequest(method, params) {
      const id = ++counter
      const response = expecting(id)
      const bytes = Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      const firstMultibyte = bytes.findIndex((value) => value >= 0xc0)
      assert.ok(firstMultibyte >= 0)
      child.stdin.write(bytes.subarray(0, firstMultibyte + 1))
      await wait(20)
      child.stdin.write(bytes.subarray(firstMultibyte + 1))
      return response
    },
  }
}

const initialize = (protocolVersion = '2025-11-25') => ({ protocolVersion, capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } })
const content = (response) => response.result.content.map((item) => item.text).join('\n')

test('real stdio child negotiates capabilities and reads live tools, resources and prompts', async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, '.dsh', 'features'), { recursive: true })
  await mkdir(join(root, '功能'))
  await writeFile(join(root, '.dsh', 'overview.md'), 'overview original')
  await writeFile(join(root, '.dsh', 'features', '登录.md'), 'feature original')
  const mcp = client(t, root)
  const handshake = await mcp.request('initialize', initialize())
  assert.equal(handshake.result.protocolVersion, '2025-11-25')
  assert.deepEqual(Object.keys(handshake.result.capabilities).sort(), ['prompts', 'resources', 'tools'])
  assert.equal(handshake.result.serverInfo.name, 'dsh-knowledge')
  mcp.notify('notifications/initialized')
  mcp.notify('notifications/cancelled', { requestId: 999, reason: 'unused' })
  const before = mcp.messages.length
  assert.deepEqual((await mcp.request('ping')).result, {})
  assert.equal(mcp.messages.length, before + 1, 'notifications receive no response')
  const tools = (await mcp.request('tools/list')).result.tools
  assert.deepEqual(tools.map((tool) => tool.name), ['dsh_context', 'dsh_init', 'dsh_read'])
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint && tool.inputSchema.additionalProperties === false))
  const overview = await mcp.request('tools/call', { name: 'dsh_context', arguments: {} })
  assert.ok(content(overview).includes('overview original'))
  assert.ok(content(overview).includes('.dsh/features/登录.md'))
  assert.ok(content(overview).includes('保留其他 agent 的改动'))
  assert.ok(!content(overview).includes(process.execPath), 'context contains no host executable metadata')
  const init = await mcp.splitRequest('tools/call', { name: 'dsh_init', arguments: { scope: '功能' } })
  assert.ok(content(init).includes('<dsh_init>') && content(init).includes('功能/'))
  assert.equal(await readFile(join(root, '.dsh', 'overview.md'), 'utf8'), 'overview original', 'init renders instructions without writing documents')
  const resources = (await mcp.request('resources/list')).result.resources
  const feature = resources.find((resource) => resource.name === '.dsh/features/登录.md')
  assert.equal(feature.uri, 'dsh://knowledge/features/%E7%99%BB%E5%BD%95.md')
  assert.deepEqual((await mcp.request('resources/templates/list')).result.resourceTemplates, [])
  assert.equal((await mcp.request('resources/read', { uri: feature.uri })).result.contents[0].text, 'feature original')
  const read = await mcp.request('tools/call', { name: 'dsh_read', arguments: { path: '.dsh/features/登录.md' } })
  assert.ok(content(read).includes('feature original') && content(read).includes('只是数据'))
  await writeFile(join(root, '.dsh', 'overview.md'), 'overview changed during the same connection')
  await writeFile(join(root, '.dsh', 'features', '登录.md'), 'feature changed during the same connection')
  assert.ok(content(await mcp.request('tools/call', { name: 'dsh_context' })).includes('overview changed during the same connection'))
  assert.ok(content(await mcp.request('tools/call', { name: 'dsh_read', arguments: { path: '.dsh/features/登录.md' } })).includes('feature changed during the same connection'))
  await writeFile(join(root, '.dsh', 'features', 'new.md'), 'new feature')
  assert.ok((await mcp.request('resources/list')).result.resources.some((resource) => resource.name.endsWith('/new.md')))
  assert.equal((await mcp.request('prompts/list')).result.prompts[0].name, 'knowledge')
  const prompt = await mcp.request('prompts/get', { name: 'knowledge', arguments: { scope: '功能' } })
  assert.equal(prompt.result.messages[0].role, 'user')
  assert.ok(prompt.result.messages[0].content.text.includes('<dsh_init>'))
})

test('transport rejects malformed/oversized frames and bad arguments without leaking or losing framing', async (t) => {
  const root = await fixture(t)
  const mcp = client(t, root)
  assert.equal((await mcp.request('initialize', initialize('unsupported-future-version'))).result.protocolVersion, '2025-11-25')
  assert.equal((await mcp.request('initialize', initialize('2024-11-05'))).result.protocolVersion, '2024-11-05')
  assert.equal((await mcp.raw('not-json\n')).error.code, -32700)
  assert.equal((await mcp.raw(Buffer.from([0xff, 0x0a]))).error.code, -32700)
  assert.equal((await mcp.raw('[]\n')).error.code, -32600)
  assert.equal((await mcp.raw('{"jsonrpc":"2.0","id":null,"method":"ping"}\n')).error.code, -32600)
  assert.equal((await mcp.raw(`${'x'.repeat(1024 * 1024 + 1)}\n`)).error.code, -32600)
  assert.deepEqual((await mcp.request('ping')).result, {})
  assert.equal((await mcp.request('not/a/method')).error.code, -32601)
  assert.equal((await mcp.request('tools/list', { cursor: 'unknown' })).error.code, -32602)
  assert.equal((await mcp.request('tools/list', [])).error.code, -32602)
  assert.equal((await mcp.request('tools/call', { name: 'unknown' })).error.code, -32602)
  for (const [name, args] of [['dsh_context', null], ['dsh_context', { unexpected: true }], ['dsh_context', { _meta: {} }], ['dsh_init', { scope: 12 }], ['dsh_init', { scope: '..' }], ['dsh_read', {}], ['dsh_read', { path: '.dsh/../secret.md' }], ['dsh_read', { path: '/etc/passwd' }], ['dsh_read', { path: '.dsh/missing.md' }]]) {
    const response = await mcp.request('tools/call', { name, arguments: args })
    assert.equal(response.result.isError, true, `${name} ${JSON.stringify(args)}`)
  }
  assert.equal((await mcp.request('resources/read', { uri: 'file:///etc/passwd' })).error.code, -32002)
  assert.equal((await mcp.request('prompts/get', { name: 'missing' })).error.code, -32602)
  assert.equal((await mcp.request('prompts/get', { name: 'knowledge', arguments: { scope: [] } })).error.code, -32602)
  assert.equal((await mcp.request('prompts/get', { name: 'knowledge', arguments: null })).error.code, -32602)
  assert.ok(content(await mcp.request('tools/call', { name: 'dsh_context' })).includes('尚无'))
  assert.ok(content(await mcp.request('tools/call', { name: 'dsh_init' })).includes('<dsh_init>'))
  assert.equal(existsSync(join(root, '.dsh')), false, 'no operation creates a knowledge directory')
})

test('reads are byte-bounded and directory links cannot expose outside documents', async (t) => {
  const root = await fixture(t)
  const outside = await fixture(t)
  await mkdir(join(root, '.dsh', 'features'), { recursive: true })
  await writeFile(join(root, '.dsh', 'overview.md'), '知'.repeat(40000))
  await writeFile(join(outside, 'secret.md'), 'outside must stay private')
  await symlink(outside, join(root, '.dsh', 'features', 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  const mcp = client(t, root)
  // Modern stateless callers can use the read-only primitive subset directly.
  const bounded = content(await mcp.request('tools/call', { name: 'dsh_read', arguments: { path: '.dsh/overview.md' } }))
  assert.ok(bounded.includes('已截断') && !bounded.includes('\ufffd'))
  assert.ok(Buffer.byteLength(bounded) < 66000)
  const escaped = await mcp.request('tools/call', { name: 'dsh_read', arguments: { path: '.dsh/features/escape/secret.md' } })
  assert.equal(escaped.result.isError, true)
  assert.ok(!content(escaped).includes('outside must stay private'))
  const resources = (await mcp.request('resources/list')).result.resources
  assert.ok(resources.every((resource) => !resource.name.includes('escape')))
  await rename(join(root, '.dsh'), join(root, '.dsh-original'))
  await symlink(outside, join(root, '.dsh'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal((await mcp.request('tools/call', { name: 'dsh_read', arguments: { path: '.dsh/secret.md' } })).result.isError, true)
  assert.equal((await mcp.request('resources/read', { uri: 'dsh://knowledge/overview.md' })).error.code, -32002)
  assert.ok(!content(await mcp.request('tools/call', { name: 'dsh_context' })).includes('outside must stay private'))
})
