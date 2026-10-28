import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporaryParent = realpathSync(tmpdir())
const root = mkdtempSync(join(temporaryParent, 'dsh-knowledge-package-'))
const fixture = (name) => {
  const dir = join(root, name)
  for (const path of ['scripts/package-minimax.mjs', 'scripts/context.mjs', 'lib/knowledge.mjs', 'skills/knowledge/SKILL.md', 'LICENSE', 'package.json']) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    copyFileSync(join(source, path), join(dir, path))
  }
  return dir
}
const run = (dir, args = []) => spawnSync(process.execPath, [join(dir, 'scripts/package-minimax.mjs'), ...args], { cwd: dir, encoding: 'utf8' })

try {
  const dir = fixture('normal')
  const built = run(dir)
  assert.equal(built.status, 0, built.stderr)
  const output = join(dir, 'dist/minimaxcode')
  const manifestPath = join(output, '.claude-plugin/plugin.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const packageMetadata = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.equal(manifest.version, packageMetadata.version)
  for (const skill of manifest.skills) {
    assert.ok(skill.startsWith('./'))
    const path = resolve(dirname(manifestPath), skill)
    const rel = relative(output, path)
    assert.ok(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
    assert.equal(readFileSync(path, 'utf8'), readFileSync(join(dir, 'skills/knowledge/SKILL.md'), 'utf8'))
  }
  assert.equal(readFileSync(join(output, 'skills/knowledge/SKILL.md'), 'utf8'), readFileSync(join(dir, 'skills/knowledge/SKILL.md'), 'utf8'))
  for (const event of ['UserPromptSubmit', 'SessionEnd']) {
    const hook = manifest.hooks[event][0].hooks[0]
    assert.equal(hook.command, 'node')
    assert.deepEqual(hook.args, ['${PLUGIN_ROOT}/scripts/context.mjs', '--agent', 'minimax'])
    const script = hook.args[0].replace('${PLUGIN_ROOT}', output)
    assert.ok(lstatSync(script).isFile())
  }
  for (const path of ['lib/knowledge.mjs', 'scripts/context.mjs', 'LICENSE']) {
    assert.deepEqual(readFileSync(join(output, path)), readFileSync(join(dir, path)))
  }

  // The generated package is self-contained, including its hook's shared-core import.
  const project = join(root, 'project')
  mkdirSync(join(project, '.dsh'), { recursive: true })
  writeFileSync(join(project, 'package.json'), '{}')
  writeFileSync(join(project, '.dsh/overview.md'), '# Generated package context fixture\n')
  const invoked = spawnSync(process.execPath, [join(output, 'scripts/context.mjs'), '--agent', 'minimax'], {
    cwd: project, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: project, prompt: 'explain the project' }),
  })
  assert.equal(invoked.status, 0, invoked.stderr)
  assert.match(JSON.parse(invoked.stdout).hookSpecificOutput.additionalContext, /Generated package context fixture/)

  // Rebuilding refreshes generated assets but preserves unrelated output files.
  writeFileSync(join(output, 'keep.txt'), 'user attachment')
  writeFileSync(join(dir, 'skills/knowledge/SKILL.md'), '---\nname: knowledge\ndescription: updated\n---\nUpdated canonical skill.\n')
  assert.equal(run(dir).status, 0)
  assert.equal(readFileSync(join(output, 'keep.txt'), 'utf8'), 'user attachment')
  assert.equal(readFileSync(join(output, '.claude-plugin/skills/knowledge/SKILL.md'), 'utf8'), readFileSync(join(dir, 'skills/knowledge/SKILL.md'), 'utf8'))
  assert.equal(run(dir).status, 0)
  assert.notEqual(run(dir, ['--output', join(root, 'elsewhere')]).status, 0)
  assert.equal(existsSync(join(root, 'elsewhere')), false)

  const unowned = fixture('unowned')
  mkdirSync(join(unowned, 'dist/minimaxcode'), { recursive: true })
  writeFileSync(join(unowned, 'dist/minimaxcode/user.txt'), 'preserve')
  assert.notEqual(run(unowned).status, 0)
  assert.equal(readFileSync(join(unowned, 'dist/minimaxcode/user.txt'), 'utf8'), 'preserve')
  assert.equal(existsSync(join(unowned, 'dist/minimaxcode/lib')), false)

  const blocked = fixture('blocked')
  mkdirSync(join(blocked, 'dist/minimaxcode'), { recursive: true })
  writeFileSync(join(blocked, 'dist/minimaxcode/.dsh-knowledge-generated.json'), '{"generator":"dsh-knowledge/package-minimax-v1"}')
  writeFileSync(join(blocked, 'dist/minimaxcode/lib'), 'must remain a file')
  assert.notEqual(run(blocked).status, 0)
  assert.equal(readFileSync(join(blocked, 'dist/minimaxcode/lib'), 'utf8'), 'must remain a file')
  assert.equal(existsSync(join(blocked, 'dist/minimaxcode/package.json')), false)

  const linked = fixture('linked')
  const outside = join(root, 'outside')
  mkdirSync(outside)
  symlinkSync(outside, join(linked, 'dist'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.notEqual(run(linked).status, 0)
  assert.equal(existsSync(join(outside, 'minimaxcode')), false)
  console.log('MiniMax package: self-contained assets, relative skills, executable hooks, idempotence and safe output checks passed')
} finally {
  // Only delete this test's verified, freshly allocated directory under the temp root.
  assert.equal(dirname(resolve(root)), temporaryParent)
  assert.ok(root.startsWith(join(temporaryParent, 'dsh-knowledge-package-')))
  rmSync(root, { recursive: true, force: true })
}
