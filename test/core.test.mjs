import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, parse, resolve } from 'node:path'
import test from 'node:test'
import { DOC_LIST_LIMIT, OVERVIEW_LIMIT, composeReminder, findProjectRoot, listDocuments, readKnowledgeBase, refuseScope, resolveScope } from '../lib/knowledge.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-core-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, '.git'))
  return dir
}

test('all packages in a repository share one root even with nested .dsh', async (t) => {
  const dir = await fixture(t)
  const nested = join(dir, 'packages', 'nested')
  await mkdir(join(nested, '.dsh'), { recursive: true })
  await writeFile(join(nested, 'package.json'), '{}')
  assert.equal(findProjectRoot(nested), dir)
  assert.equal(resolveScope(nested, '.').projectRoot, dir)
})

test('scope containment checks real paths and permits names starting with two dots', async (t) => {
  const dir = await fixture(t)
  const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await mkdir(join(dir, '..valid'))
  assert.equal(resolveScope(dir, '..valid').scope, '..valid')
  assert.ok(resolveScope(dir, outside).error)
  await symlink(outside, join(dir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.ok(resolveScope(dir, 'escape').error)
})

test('plain projects without manifest files discover their existing knowledge root', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plain-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, '.dsh'))
  await mkdir(join(dir, 'src'))
  assert.equal(findProjectRoot(join(dir, 'src')), dir)
})

test('symlinked knowledge directories cannot leak external content or receive init writes', async (t) => {
  const dir = await fixture(t)
  const outside = await mkdtemp(join(tmpdir(), 'dsh-external-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'overview.md'), 'external private content')
  await symlink(outside, join(dir, '.dsh'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.deepEqual(await listDocuments(join(dir, '.dsh')), [])
  assert.equal((await readKnowledgeBase(dir)).exists, false)
  assert.ok(resolveScope(dir, '').error)
})

test('home, configured state directory and the native filesystem root are refused', () => {
  const original = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = join(tmpdir(), 'dsh-config')
    assert.ok(refuseScope(homedir()))
    assert.ok(refuseScope(join(homedir(), '.dsh')))
    assert.ok(refuseScope(process.env.DSH_HOME))
    assert.ok(refuseScope(parse(resolve('.')).root))
  } finally {
    if (original === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = original
  }
})

test('overview and listing are bounded, overview survives a full document listing', async (t) => {
  const dir = await fixture(t)
  const knowledge = join(dir, '.dsh')
  await mkdir(join(knowledge, 'features'), { recursive: true })
  await writeFile(join(knowledge, 'overview.md'), '知'.repeat(OVERVIEW_LIMIT * 3))
  await Promise.all(Array.from({ length: DOC_LIST_LIMIT + 5 }, (_, i) => writeFile(join(knowledge, 'features', `${i}.md`), 'feature')))
  const read = await readKnowledgeBase(dir)
  assert.equal(read.documents.length, DOC_LIST_LIMIT)
  assert.ok(read.documents.includes('overview.md'))
  assert.equal(read.overview.length, OVERVIEW_LIMIT + 1)
  const reminder = composeReminder({ ...read, scope: '.' })
  assert.ok(reminder.includes('已截断'))
  await writeFile(join(knowledge, 'overview.md'), 'changed')
  assert.notEqual((await readKnowledgeBase(dir)).fingerprint, read.fingerprint)
})
