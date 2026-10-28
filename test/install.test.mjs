import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { AGENTS } from '../lib/agents.mjs'
import { installProject, planInstall, resolveAgents } from '../lib/install.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'bin/dsh-knowledge.mjs')
const sandbox = mkdtempSync(join(tmpdir(), 'dsh-knowledge-install-'))
let checks = 0
const check = (condition, message) => { assert.ok(condition, message); checks++ }
function project(name) {
  const path = join(sandbox, name)
  mkdirSync(path)
  writeFileSync(join(path, 'package.json'), '{"name":"fixture"}\n')
  return path
}
function write(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
function snapshot(path, prefix = '') {
  return Object.fromEntries(readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`
    return entry.isDirectory() ? Object.entries(snapshot(join(path, entry.name), `${relative}/`)) : [[relative, readFileSync(join(path, entry.name)).toString('base64')]]
  }))
}
function run(args, cwd = sandbox) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 15000, windowsHide: true })
}

try {
  const path = project('project with spaces 中文')
  write(join(path, 'AGENTS.md'), '# Existing instructions\nKeep this custom text.\n')
  write(join(path, '.cursor/rules/dsh-knowledge.mdc'), '---\ncustom: keep\nalwaysApply: false\n---\nA user note.\n')
  const oldHook = { matcher: '*', hooks: [{ type: 'command', command: 'echo keep-user-hook', timeout: 4 }] }
  write(join(path, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { UserPromptSubmit: [oldHook], Stop: [oldHook] } }))
  const before = snapshot(path)
  const dry = run(['install', '--agent', 'all', '--project', path, '--dry-run'])
  check(dry.status === 0 && dry.stdout.includes('Dry run'), `dry run succeeds: ${dry.stderr}`)
  assert.deepEqual(snapshot(path), before, 'dry run writes no files or directories'); checks++
  const installed = run(['install', '--agent', 'all', '--project', path])
  check(installed.status === 0, `all-agent install succeeds: ${installed.stderr}`)
  check(installed.stdout.includes('aider --read AGENTS.md'), 'Aider explicit read requirement is reported')
  check(installed.stdout.includes('retained source directory'), 'OpenCode retained-path dependency is reported')
  check(installed.stdout.includes('Cordis profile bundle') && installed.stdout.includes('native .minimax-plugin package'), 'DSH and MiniMax native plugin activation requirements are reported')
  check(readFileSync(join(path, 'AGENTS.md'), 'utf8').startsWith('# Existing instructions\nKeep this custom text.\n'), 'existing instructions are preserved')
  check((readFileSync(join(path, 'AGENTS.md'), 'utf8').match(/<!-- dsh-knowledge:start -->/g) ?? []).length === 1, 'shared AGENTS path gets only one managed block')
  const cursor = readFileSync(join(path, '.cursor/rules/dsh-knowledge.mdc'), 'utf8')
  check(cursor.includes('custom: keep') && cursor.includes('A user note.') && cursor.includes('alwaysApply: true'), 'custom rule text and YAML fields survive while activation is enabled')
  check(readFileSync(join(path, '.windsurf/rules/dsh-knowledge.md'), 'utf8').includes('trigger: always_on'), 'Windsurf rule has native trigger')
  check(readFileSync(join(path, '.augment/rules/dsh-knowledge.md'), 'utf8').includes('type: always_apply'), 'Augment rule has native type')
  check(readFileSync(join(path, '.continue/rules/dsh-knowledge.md'), 'utf8').includes('alwaysApply: true'), 'Continue rule is enabled')
  check(readFileSync(join(path, '.trae/rules/dsh-knowledge.md'), 'utf8').includes('alwaysApply: true'), 'Trae rule is enabled')
  check(readFileSync(join(path, '.codebuddy/rules/dsh-knowledge/RULE.mdc'), 'utf8').includes('enabled: true'), 'CodeBuddy rule is enabled')
  for (const definition of Object.values(AGENTS)) {
    for (const instruction of definition.instructions) check(readFileSync(join(path, instruction.path), 'utf8').includes('.dsh/overview.md'), `${definition.name} points to shared overview`)
    if (definition.skillPath) check(/^---\r?\nname: knowledge\r?\n/.test(readFileSync(join(path, definition.skillPath), 'utf8')), `${definition.name} receives valid skill frontmatter`)
  }
  const settings = JSON.parse(readFileSync(join(path, '.claude/settings.json'), 'utf8'))
  assert.deepEqual(settings.permissions, { allow: ['Read'] }, 'permissions survive'); checks++
  assert.deepEqual(settings.hooks.Stop, [oldHook], 'unrelated events survive'); checks++
  assert.deepEqual(settings.hooks.UserPromptSubmit[0], oldHook, 'existing hooks survive'); checks++
  check(settings.hooks.UserPromptSubmit.length === 2, 'exactly one managed Claude hook is added')
  check(settings.hooks.SessionStart[0].matcher === 'compact|resume', 'Claude restores full context on compaction and resume')
  const hook = settings.hooks.UserPromptSubmit[1].hooks[0]
  check(hook.command.includes('--agent claude') && hook.command.includes('context.mjs'), 'native Claude hook calls unified context script')
  const hookResult = spawnSync(hook.command, { cwd: path, shell: true, input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: path }), encoding: 'utf8', timeout: 10000, windowsHide: true })
  check(hookResult.status === 0 && JSON.parse(hookResult.stdout).hookSpecificOutput.additionalContext.includes('.dsh/'), `installed hook command executes: ${hookResult.stderr}`)
  const gemini = JSON.parse(readFileSync(join(path, '.gemini/settings.json'), 'utf8'))
  check(gemini.hooks.BeforeAgent[0].hooks[0].timeout === 10000, 'Gemini hook timeout uses milliseconds')
  const codexHooks = JSON.parse(readFileSync(join(path, '.codex/hooks.json'), 'utf8'))
  check(codexHooks.hooks.UserPromptSubmit[0].hooks[0].command.includes('--dsh-knowledge-managed'), 'Codex project hooks are generated')
  const copilotHooks = JSON.parse(readFileSync(join(path, '.github/hooks/dsh-knowledge.json'), 'utf8'))
  check(copilotHooks.version === 1 && copilotHooks.hooks.userPromptTransformed[0].command.includes('--agent copilot'), 'Copilot installs userPromptTransformed')
  check(copilotHooks.hooks.userPromptSubmitted === undefined, 'Copilot does not install the ignored submit hook')
  const qoderHooks = JSON.parse(readFileSync(join(path, '.qoder/settings.json'), 'utf8'))
  check(qoderHooks.hooks.PostToolUse && qoderHooks.hooks.FileChanged && qoderHooks.hooks.PostCompact, 'both Qoder profiles keep only the richer CLI hooks')
  const devinHooks = JSON.parse(readFileSync(join(path, '.devin/hooks.v1.json'), 'utf8'))
  assert.deepEqual(Object.keys(devinHooks), ['PostCompaction'], 'Claude plus Devin installs only the Devin compaction hook'); checks++
  check(devinHooks.hooks === undefined, 'Devin hooks are an event map')
  const wrapper = readFileSync(join(path, '.opencode/plugins/dsh-knowledge.js'), 'utf8')
  check(wrapper.includes('file:///') && wrapper.includes('adapters/opencode.js'), 'OpenCode wrapper imports the retained adapter via file URL')
  check(!Object.hasOwn(snapshot(path), '.opencode/commands/knowledge.md'), 'OpenCode native executor is not shadowed by a duplicate command file')
  const after = snapshot(path)
  const again = run(['install', '--agent', 'all', '--project', path])
  check(again.status === 0 && again.stdout.includes('0 file(s) changed'), `repeat installation is a no-op: ${again.stderr}`)
  assert.deepEqual(snapshot(path), after, 'all files remain byte-identical on repeat'); checks++
  check(!Object.hasOwn(snapshot(path), '.dsh/overview.md'), 'install never invents knowledge documents')

  const context = run(['context', '--project', path])
  check(context.status === 0 && context.stdout.includes('项目尚无'), 'context reports absent knowledge without writing')
  const init = run(['init', '--project', path])
  check(init.status === 0 && init.stdout.includes('<dsh_init>') && init.stdout.includes(join(path, '.dsh')), 'init prints the build prompt with the correct root')
  assert.deepEqual(snapshot(path), after, 'context and init are read-only'); checks++
  const listed = run(['agents'])
  check(listed.status === 0 && listed.stdout.includes('claude-code\tClaude Code'), 'agents lists native identifiers')
  check(listed.stdout.includes('devin\tDevin') && listed.stdout.includes('qoder-cli\tQoder CLI'), 'agents lists Devin and Qoder CLI')
  check(Object.keys(AGENTS).filter((id) => id !== 'generic').length === 23, 'registry has 23 named agents')
  assert.deepEqual(resolveAgents('claudecode,codex'), ['claude-code', 'codex']); checks++
  check(run(['install', '--agent', 'not-an-agent', '--project', path]).status === 1, 'unknown agent fails')
  check(run(['install', '--project']).status === 1, 'missing option value fails')
  check(run(['init', '--project', join(path, 'absent')]).status === 1, 'a missing project cannot initialize an ancestor by accident')

  const crlf = project('CRLF custom instructions')
  write(join(crlf, 'AGENTS.md'), 'Custom Windows instructions\r\n')
  installProject({ project: crlf, agent: 'generic' })
  const windowsText = readFileSync(join(crlf, 'AGENTS.md'), 'utf8')
  check(!windowsText.includes('\r\r\n') && windowsText.startsWith('Custom Windows instructions\r\n'), 'Windows line endings are preserved without doubled carriage returns')
  check(planInstall({ project: crlf, agent: 'generic' }).changes.length === 0, 'CRLF managed rules are idempotent')

  const broken = project('invalid config')
  write(join(broken, '.gemini/settings.json'), '{broken json')
  const unchanged = snapshot(broken)
  check(run(['install', '--agent', 'all', '--project', broken]).status === 1, 'invalid settings fail installation')
  assert.deepEqual(snapshot(broken), unchanged, 'invalid JSON prevents every planned write'); checks++
  const ambiguous = project('ambiguous markers')
  write(join(ambiguous, 'AGENTS.md'), 'User text\n<!-- dsh-knowledge:start -->\nMissing end')
  const ambiguousBefore = snapshot(ambiguous)
  assert.throws(() => installProject({ project: ambiguous, agent: 'all' }), /markers/); checks++
  assert.deepEqual(snapshot(ambiguous), ambiguousBefore, 'ambiguous markers preserve all files'); checks++
  assert.throws(() => planInstall({ project: homedir(), agent: 'generic' }), /用户主目录/); checks++
  const savedHome = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = path
    assert.throws(() => planInstall({ project: path, agent: 'generic' }), /配置目录/); checks++
  } finally { if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome }

  const unowned = project('custom opencode wrapper')
  write(join(unowned, '.opencode/plugins/dsh-knowledge.js'), 'export default customPlugin\n')
  const unownedBefore = snapshot(unowned)
  assert.throws(() => installProject({ project: unowned, agent: 'opencode' }), /not managed/); checks++
  assert.deepEqual(snapshot(unowned), unownedBefore, 'unowned executable file is never overwritten'); checks++

  const geminiUser = project('gemini user settings')
  write(join(geminiUser, '.gemini/settings.json'), `${JSON.stringify({
    model: 'keep-user-model',
    hooks: { BeforeAgent: [{ hooks: [
      { type: 'command', command: 'echo old --dsh-knowledge-managed', timeout: 1 },
      { type: 'command', command: 'echo keep-user-hook' },
    ] }] },
  }, null, 2)}\n`)
  installProject({ project: geminiUser, agent: 'gemini' })
  const mergedGemini = JSON.parse(readFileSync(join(geminiUser, '.gemini/settings.json'), 'utf8'))
  check(mergedGemini.model === 'keep-user-model', 'Gemini user settings survive hook merge')
  const beforeAgent = JSON.stringify(mergedGemini.hooks.BeforeAgent)
  check(beforeAgent.includes('echo keep-user-hook') && !beforeAgent.includes('echo old'), 'Gemini merge drops only managed handlers')
  check(mergedGemini.hooks.BeforeAgent.at(-1).hooks[0].timeout === 10000, 'merged Gemini hook timeout stays in milliseconds')
  check(planInstall({ project: geminiUser, agent: 'gemini' }).changes.length === 0, 'merged Gemini settings are byte-stable')

  const devinOnly = project('devin alone')
  installProject({ project: devinOnly, agent: 'devin' })
  const alone = JSON.parse(readFileSync(join(devinOnly, '.devin/hooks.v1.json'), 'utf8'))
  check(alone.SessionStart && alone.UserPromptSubmit && alone.PostCompaction && alone.hooks === undefined, 'Devin alone installs its full event map')
  check(readFileSync(join(devinOnly, '.agents/skills/knowledge/SKILL.md'), 'utf8').includes('name: knowledge'), 'Devin shares the Codex skill path')
  const qoderOnly = project('qoder alone')
  installProject({ project: qoderOnly, agent: 'qoder' })
  const ideHooks = JSON.parse(readFileSync(join(qoderOnly, '.qoder/settings.json'), 'utf8'))
  check(ideHooks.hooks.SessionStart && !ideHooks.hooks.PostToolUse && !ideHooks.hooks.FileChanged, 'Qoder IDE alone omits CLI-only events')

  const unmanaged = project('unmanaged generated file')
  write(join(unmanaged, '.gemini/commands/knowledge.toml'), 'description = "local only"\n')
  const unmanagedBefore = snapshot(unmanaged)
  assert.throws(() => installProject({ project: unmanaged, agent: 'gemini' }), /not managed/); checks++
  assert.deepEqual(snapshot(unmanaged), unmanagedBefore, 'unmanaged generated file is not overwritten'); checks++

  const linked = project('linked config')
  const outside = project('outside')
  symlinkSync(outside, join(linked, '.claude'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => planInstall({ project: linked, agent: 'claude-code' }), /symbolic link|junction/); checks++
  check(readdirSync(outside).length === 1, 'symlinked config cannot write outside the project')
  const alias = join(sandbox, 'linked project')
  symlinkSync(path, alias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => planInstall({ project: alias, agent: 'generic' }), /symbolic link|junction/); checks++

  console.log(`PASS ${checks} installer and CLI checks`)
} finally {
  const target = resolve(sandbox)
  const temp = resolve(tmpdir())
  assert.ok(target.startsWith(`${temp}\\`) || target.startsWith(`${temp}/`), 'cleanup stays inside the temporary directory')
  rmSync(target, { recursive: true, force: true })
}
