// Report imported bindings that the file never uses.
//
// A plain correctness check for this codebase: every module here is hand-written
// and small, so a stale import is a real smell rather than noise.
import { readFile, readdir } from 'node:fs/promises'

const files = (await readdir('.')).filter((name) => name.endsWith('.js')).sort()
let problems = 0

for (const file of files) {
  const text = await readFile(file, 'utf8')
  for (const match of text.matchAll(/^import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\})?\s*(?:from\s*)?/gm)) {
    const names = []
    if (match[1] !== undefined) names.push(match[1])
    if (match[2] !== undefined) {
      for (const entry of match[2].split(',')) {
        const trimmed = entry.trim()
        if (trimmed === '') continue
        names.push(trimmed.includes(' as ') ? trimmed.split(' as ').at(-1).trim() : trimmed)
      }
    }
    for (const name of names) {
      if (name === '' || name === '*') continue
      const pattern = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g')
      const uses = [...text.matchAll(pattern)].length
      if (uses <= 1) {
        console.log(`UNUSED  ${file}  ${name}`)
        problems += 1
      }
    }
  }
}

console.log(problems === 0 ? 'no unused imports' : `${problems} unused import(s)`)
process.exit(problems === 0 ? 0 : 1)
