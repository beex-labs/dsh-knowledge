import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { handleEvent } from '../scripts/context.mjs'

test('native hooks inject, deduplicate, restore, refresh and clear shared context', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-hook-'))
  const previous = process.env.PLUGIN_DATA
  process.env.PLUGIN_DATA = join(dir, 'state')
  try {
    const root = join(dir, 'project')
    await mkdir(join(root, '.git'), { recursive: true })
    const event = { cwd: root, session_id: 'session', hook_event_name: 'UserPromptSubmit', prompt: 'fix bug' }
    const text = (response) => response.hookSpecificOutput.additionalContext
    assert.match(text(await handleEvent(event)), /尚无共享知识库/)
    await mkdir(join(root, '.dsh'), { recursive: true })
    await writeFile(join(root, '.dsh/overview.md'), 'UNIQUE_PROJECT_OVERVIEW')
    assert.match(text(await handleEvent(event)), /UNIQUE_PROJECT_OVERVIEW/)
    assert.doesNotMatch(text(await handleEvent(event)), /UNIQUE_PROJECT_OVERVIEW/)
    assert.match(text(await handleEvent({ ...event, hook_event_name: 'SessionStart' })), /UNIQUE_PROJECT_OVERVIEW/)
    await writeFile(join(root, '.dsh/overview.md'), 'UPDATED_PROJECT_OVERVIEW_LONGER')
    assert.match(text(await handleEvent(event)), /UPDATED_PROJECT_OVERVIEW_LONGER/)
    await handleEvent({ ...event, hook_event_name: 'SessionEnd' })
    assert.match(text(await handleEvent(event)), /UPDATED_PROJECT_OVERVIEW_LONGER/)
    assert.match(text(await handleEvent({ ...event, prompt: '/knowledge' })), /<dsh_init>/)
    assert.doesNotMatch(text(await handleEvent({ ...event, prompt: 'explain /knowledge please' })), /<dsh_init>/)
    assert.match(text(await handleEvent({ ...event, prompt: '/knowledge ../' })), /无法执行/)
    const gemini = await handleEvent({ ...event, hook_event_name: 'BeforeAgent' }, 'gemini')
    assert.equal(gemini.hookSpecificOutput.hookEventName, 'BeforeAgent')
    assert.match(text(gemini), /UPDATED_PROJECT_OVERVIEW_LONGER/)
    await writeFile(join(root, '.dsh/overview.md'), 'Z'.repeat(40000))
    assert.ok(text(await handleEvent(event)).length < 10000)
    assert.equal(await handleEvent({ ...event, hook_event_name: 'Stop' }), undefined)
    assert.equal(await handleEvent(null), undefined)
  } finally {
    if (previous === undefined) delete process.env.PLUGIN_DATA
    else process.env.PLUGIN_DATA = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('hook CLI keeps malformed input silent and stdout strictly JSON', async () => {
  const script = resolve('scripts/context.mjs')
  for (const input of ['invalid', 'null', '[]', '{}']) {
    const result = spawnSync(process.execPath, [script], { input, encoding: 'utf8', timeout: 8000 })
    assert.equal(result.status, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
  }
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ cwd: process.cwd(), hook_event_name: 'UserPromptSubmit' }),
    encoding: 'utf8', timeout: 8000,
  })
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.hookEventName, 'UserPromptSubmit')
})
