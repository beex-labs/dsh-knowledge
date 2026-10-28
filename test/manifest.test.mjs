import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { test } from 'node:test'

const json = async (path) => JSON.parse(await readFile(path, 'utf8'))

test('one version and one skill across portable, Claude, Codex, MiniMax and DSH', async () => {
  const pkg = await json('package.json')
  for (const path of ['plugin.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.minimax-plugin/plugin.json']) {
    const manifest = await json(path)
    assert.equal(manifest.name, pkg.name)
    assert.equal(manifest.version, pkg.version)
  }
  await access(pkg.dsh.bundle.patch)
  const marketplace = await json('.claude-plugin/marketplace.json')
  assert.equal(marketplace.plugins[0].name, pkg.name)
  assert.equal(marketplace.plugins[0].version, pkg.version)
  assert.equal(marketplace.plugins[0].source, './')
  await access(pkg.bin['dsh-knowledge'])
  for (const path of Object.values(pkg.exports)) await access(path)
  const skill = await readFile('skills/knowledge/SKILL.md', 'utf8')
  assert.match(skill, /^---\s+name: knowledge\s/m)
  assert.match(skill, /其他 agent 的修改/)
  const claude = await json('hooks/hooks.json')
  assert.match(claude.hooks.UserPromptSubmit[0].hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}/)
  const mini = await json('.minimax-plugin/plugin.json')
  const hook = await json(mini.hooks[0])
  assert.match(hook.hooks.UserPromptSubmit[0].hooks[0].command, /\$\{PLUGIN_ROOT\}/)
  for (const path of [...mini.skills, mini.icon, mini.darkIcon]) await access(path)
  assert.ok(pkg.files.includes('.claude-plugin'))
  assert.ok(pkg.files.includes('.minimax-plugin'))
})
