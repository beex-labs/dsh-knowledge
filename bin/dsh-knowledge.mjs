#!/usr/bin/env node
import { AGENTS } from '../lib/agents.mjs'
import { statSync } from 'node:fs'
import { installProject } from '../lib/install.mjs'
import { SECTION, resolveScope, readKnowledgeBase, composeReminder, initPrompt } from '../lib/knowledge.mjs'

const HELP = `DSH Knowledge — one shared project-root .dsh/ for every agent

Usage:
  dsh-knowledge agents
  dsh-knowledge install --agent <id|all> --project <path> [--dry-run]
  dsh-knowledge context [--project <path>]
  dsh-knowledge init [scope] [--project <path>]

Install merges project instructions, skills and supported native hooks.
Context and init print model prompts; they never create knowledge documents.`

async function main(argv) {
  const command = argv.shift()
  if (!command || ['help', '--help', '-h'].includes(command)) return console.log(HELP)
  if (!['agents', 'install', 'context', 'init'].includes(command)) throw new Error(`Unknown command: ${command}`)
  const options = { project: process.cwd(), agent: 'all', dryRun: false }
  const positional = []
  while (argv.length) {
    const value = argv.shift()
    if (value === '--dry-run' && command === 'install') options.dryRun = true
    else if (value === '--project' || value === '--agent' && command === 'install') {
      const argument = argv.shift()
      if (!argument || argument.startsWith('--')) throw new Error(`${value} requires a value`)
      options[value.slice(2)] = argument
    } else if (value.startsWith('-')) throw new Error(`Unknown option: ${value}`)
    else positional.push(value)
  }
  if (positional.length > (command === 'init' ? 1 : 0)) throw new Error('Unexpected positional arguments; quote paths containing spaces')
  if (command === 'agents') {
    for (const [id, agent] of Object.entries(AGENTS)) console.log(`${id}\t${agent.name}`)
    return
  }
  if (command === 'install') {
    const plan = installProject(options)
    console.log(`${options.dryRun ? 'Dry run' : 'Installed'}: ${plan.agents.join(', ')}\nProject: ${plan.project}`)
    for (const entry of plan.changes) console.log(`${entry.previous === undefined ? 'CREATE' : 'UPDATE'} ${entry.path}`)
    console.log(`${plan.changes.length} file(s) ${options.dryRun ? 'would change' : 'changed'}; knowledge documents are created by the agent on request.`)
    if (plan.agents.includes('aider')) console.log('Aider: start with aider --read AGENTS.md to load the shared knowledge instructions.')
    if (plan.agents.includes('opencode')) console.log('OpenCode: the project plugin imports this retained source directory; keep it at its current location.')
    if (plan.agents.includes('dsh')) console.log('DSH: project rules are installed; load this repository as a Cordis profile bundle to enable the native /init command and context hook.')
    if (plan.agents.includes('minimaxcode')) console.log('MiniMax Code: project rules are installed; load this repository as a native .minimax-plugin package to enable its skill and per-turn hooks.')
    return
  }
  try { if (!statSync(options.project).isDirectory()) throw new Error() } catch { throw new Error(`Project directory does not exist: ${options.project}`) }
  const scope = resolveScope(options.project, command === 'init' ? positional[0] : undefined)
  if (scope.error) throw new Error(scope.error)
  const knowledge = await readKnowledgeBase(scope.projectRoot)
  if (command === 'init') console.log(initPrompt({ ...scope, hasKnowledgeBase: knowledge.exists }))
  else console.log(`${SECTION}\n\n${knowledge.exists ? composeReminder({ ...knowledge, scope: scope.scope }) : '项目尚无 .dsh/ 知识库。仅在用户明确要求时使用 knowledge 技能，或将 init 命令输出交给模型执行；不要创建空知识库。'}`)
}

try { await main(process.argv.slice(2)) } catch (error) {
  console.error(`dsh-knowledge: ${error.message}`)
  process.exitCode = 1
}
