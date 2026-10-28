#!/usr/bin/env node
// Generate the version-specific MiniMax package from the canonical shared sources.
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const OUTPUT = join(ROOT, 'dist', 'minimaxcode')
const MARKER = '.dsh-knowledge-generated.json'
const OWNER = 'dsh-knowledge/package-minimax-v1'

function stat(path) {
  try { return lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}

function safe(path, directory = false) {
  const rel = relative(ROOT, path)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Package path escapes the source directory: ${path}`)
  if (path !== ROOT) safe(dirname(path), true)
  const entry = stat(path)
  if (!entry) return
  if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link or junction: ${path}`)
  if (directory ? !entry.isDirectory() : !entry.isFile()) throw new Error(`Expected ${directory ? 'directory' : 'regular file'}: ${path}`)
}

function source(path) {
  const full = join(ROOT, path)
  safe(full)
  return readFileSync(full)
}

export function packageMiniMax() {
  safe(OUTPUT, true)
  const markerPath = join(OUTPUT, MARKER)
  safe(markerPath)
  if (stat(OUTPUT) && readdirSync(OUTPUT).length) {
    let marker
    try { marker = JSON.parse(readFileSync(markerPath, 'utf8')) } catch { /* Fail closed for an unowned directory. */ }
    if (marker?.generator !== OWNER) throw new Error(`Refusing to overwrite unowned output: ${OUTPUT}`)
  }

  const metadata = JSON.parse(source('package.json').toString('utf8'))
  const skill = source('skills/knowledge/SKILL.md')
  const hooks = {}
  for (const event of ['UserPromptSubmit', 'SessionEnd']) {
    hooks[event] = [{ hooks: [{ type: 'command', command: 'node', args: ['${PLUGIN_ROOT}/scripts/context.mjs', '--agent', 'minimax'], timeout: 10 }] }]
  }
  const manifest = {
    name: metadata.name,
    version: metadata.version,
    description: 'Shared project-root .dsh knowledge skill; MiniMax Code 0.4 hook compatibility requires runtime verification.',
    author: { name: 'beex-labs' },
    repository: 'https://github.com/beex-labs/dsh-knowledge',
    license: metadata.license,
    // The published spec says paths are manifest-relative and must begin with ./.
    skills: ['./skills/knowledge/SKILL.md'],
    hooks,
  }
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`
  const files = new Map([
    ['lib/knowledge.mjs', source('lib/knowledge.mjs')],
    ['scripts/context.mjs', source('scripts/context.mjs')],
    ['skills/knowledge/SKILL.md', skill],
    ['.claude-plugin/skills/knowledge/SKILL.md', skill],
    ['LICENSE', source('LICENSE')],
    ['package.json', json({ name: metadata.name, version: metadata.version, private: true, type: 'module', license: metadata.license, engines: metadata.engines })],
    ['.claude-plugin/plugin.json', json(manifest)],
    ['README.md', '# DSH Knowledge for MiniMax Code 0.4\n\nGenerated from the canonical dsh-knowledge sources. Do not edit generated files.\n\nThe knowledge skill reads and writes the shared project-root `.dsh/`. The inline hook layout follows the published MiniMax 0.4 proposal; hook context delivery and package discovery have not been verified in a live 0.4 runtime. Use the knowledge skill or project instructions if hooks are unavailable. See the source repository docs/agents.md for the legacy desktop profile, version boundaries, and official references.\n'],
    [MARKER, json({ generator: OWNER })],
  ])

  // Validate every output before the first write; never remove existing directories.
  for (const path of files.keys()) safe(join(OUTPUT, path))
  mkdirSync(OUTPUT, { recursive: true })
  writeFileSync(markerPath, files.get(MARKER))
  for (const [path, content] of files) {
    const target = join(OUTPUT, path)
    safe(target)
    mkdirSync(dirname(target), { recursive: true })
    safe(target)
    writeFileSync(target, content)
  }
  return { directory: OUTPUT, files: [...files.keys()] }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error('No output arguments are accepted; the output is fixed at dist/minimaxcode.')
    const result = packageMiniMax()
    console.log(`Generated ${result.files.length} files: ${result.directory}`)
  } catch (error) {
    console.error(`package-minimax: ${error.message}`)
    process.exitCode = 1
  }
}
