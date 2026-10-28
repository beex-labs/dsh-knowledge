import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { IDE_NATIVE_HOOK_PROFILES, ideNativeFiles } from '../lib/ide-native.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skill = readFileSync(join(packageRoot, 'skills/knowledge/SKILL.md'), 'utf8')
const temporaryParent = realpathSync(tmpdir())
const temporary = mkdtempSync(join(temporaryParent, 'dsh-knowledge-ide-'))
const project = join(temporary, 'project with spaces')
mkdirSync(join(project, '.dsh'), { recursive: true })
writeFileSync(join(project, 'package.json'), '{}')
writeFileSync(join(project, '.dsh/overview.md'), '# IDE native context test\n')
const options = { project, packageRoot, executable: process.execPath, skill }
const files = (id, extra = {}) => ideNativeFiles(id, { ...options, ...extra })
const hooks = (id, extra) => JSON.parse(files(id, extra).find((file) => file.kind === 'json-hooks').body)

try {
  for (const [id, definition] of Object.entries(IDE_NATIVE_HOOK_PROFILES)) {
    const config = hooks(id)
    const events = definition.style === 'event-map' ? config : config.hooks
    assert.deepEqual(Object.keys(events), definition.events)
    assert.equal(definition.style === 'flat' ? config.version : undefined, definition.style === 'flat' ? 1 : undefined)
    for (const [event, entries] of Object.entries(events)) {
      const hook = definition.style === 'flat' ? entries[0] : entries[0].hooks[0]
      assert.equal(hook.type, 'command')
      assert.equal(hook.timeout, 10)
      assert.ok(hook.command.endsWith(`--agent ${id} --event ${event} --dsh-knowledge-managed`))
      assert.ok(hook.command.includes('scripts/context.mjs'))
    }
  }
  assert.equal(files('qoder', { selectedAgents: ['qoder', 'qoder-cli'] }).some((file) => file.kind === 'json-hooks'), false)
  assert.deepEqual(Object.keys(hooks('devin', { selectedAgents: ['devin', 'claude-code'] })), ['PostCompaction'])
  assert.throws(() => files('cursor', { packageRoot: '/tmp/unsafe$path' }), /Unsupported hook path/)

  const expected = {
    cursor: ['.cursor/skills/knowledge/SKILL.md'],
    windsurf: ['.windsurf/workflows/knowledge.md', '.windsurf/skills/knowledge/SKILL.md', '.devin/workflows/knowledge.md', '.devin/skills/knowledge/SKILL.md'],
    cline: ['.cline/skills/knowledge/SKILL.md', '.cline/plugins/dsh-knowledge.js'],
    roo: ['.roo/commands/knowledge.md', '.roo/skills/knowledge/SKILL.md'],
    trae: ['.trae/commands/knowledge.md', '.trae/skills/knowledge/SKILL.md'],
    qoder: ['.qoder/commands/knowledge.md', '.qoder/skills/knowledge/SKILL.md'],
    'qoder-cli': ['.qoder/commands/knowledge.md', '.qoder/skills/knowledge/SKILL.md'],
    devin: ['.agents/skills/knowledge/SKILL.md'],
  }
  for (const [id, paths] of Object.entries(expected)) {
    const rendered = files(id).filter((file) => file.kind === 'command')
    assert.deepEqual(rendered.map((file) => file.path), paths)
    for (const file of rendered) {
      if (file.format === 'skill') assert.equal(file.body, skill)
      if (file.format === 'markdown') {
        assert.match(file.body, /description:/)
        assert.match(file.body, /项目根 \.dsh\//)
        assert.doesNotMatch(file.body, /\$ARGUMENTS/)
      }
    }
  }
  for (const id of ['windsurf', 'cline', 'roo', 'trae']) assert.equal(files(id).some((file) => file.kind === 'json-hooks'), false)
  assert.deepEqual(files('kilo'), [])

  // Import exactly the generated Cline adapter, preserving real runtime message
  // objects and image/tool parts rather than flattening them into plain text.
  const clineFile = files('cline').find((file) => file.format === 'javascript')
  const adapterPath = join(temporary, 'cline-adapter.mjs')
  writeFileSync(adapterPath, clineFile.body)
  const plugin = (await import(pathToFileURL(adapterPath).href)).default
  plugin.setup({}, { cwd: project })
  assert.deepEqual(plugin.manifest.capabilities, ['hooks'])
  assert.match((await plugin.hooks.beforeRun()).appendContext, /IDE native context test/)
  const image = { type: 'image', mediaType: 'image/png', data: 'fixture' }
  const user = { id: 'user', role: 'user', content: [image, { type: 'text', text: 'Question' }] }
  const assistant = { id: 'assistant', role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tool1', toolName: 'read_file', input: { path: 'src/a.js' } }] }
  const tool = { id: 'result', role: 'tool', content: [{ type: 'tool-result', toolCallId: 'tool1', toolName: 'read_file', output: 'source' }] }
  const messages = [user, assistant, tool]
  const amended = await plugin.hooks.beforeModel({ request: { messages } })
  assert.deepEqual(messages, [user, assistant, tool])
  assert.equal(amended.messages[0], user)
  assert.equal(amended.messages[0].content[0], image)
  assert.equal(amended.messages[1], assistant)
  assert.equal(amended.messages[2], tool)
  assert.match(amended.messages[3].content[0].text, /IDE native context test/)
  assert.equal((await plugin.hooks.beforeModel({ request: { messages: amended.messages } })).messages.length, 4)
  const afterCompaction = await plugin.hooks.beforeModel({ request: { messages: [user] } })
  assert.match(afterCompaction.messages[1].content[0].text, /IDE native context test/)
  writeFileSync(join(project, '.dsh/overview.md'), '# Fresh context after file edit\n')
  assert.match((await plugin.hooks.beforeModel({ request: { messages } })).messages[3].content[0].text, /Fresh context after file edit/)
  assert.equal(plugin.hooks.beforeTool({ toolCall: { name: 'read_file' } }), undefined)
  assert.match(plugin.hooks.beforeTool({ toolCall: { name: 'write_file' } }).appendContext, /\.dsh/)
  assert.match(plugin.hooks.afterTool({ toolCall: { name: 'edit_file' } }).appendContext, /\.dsh/)
  assert.equal(await plugin.hooks.beforeModel({ request: { messages: 'unsupported' } }), undefined)
  console.log('IDE native templates: official schemas, skill/command paths, deduplication, and Cline multimodal context passed')
} finally {
  assert.equal(dirname(resolve(temporary)), temporaryParent)
  assert.ok(temporary.startsWith(join(temporaryParent, 'dsh-knowledge-ide-')))
  rmSync(temporary, { recursive: true, force: true })
}
