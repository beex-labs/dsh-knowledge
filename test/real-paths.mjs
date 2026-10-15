// Reproduce the path forms a user actually types, against the current project.
//
// Run from a project root: `node <plugin>/test/real-paths.mjs`
import { basename } from 'node:path'

import { normalizePathArg, resolveScope } from '../index.js'

const cwd = process.cwd()
const own = basename(cwd)
const cases = [
  ['', 'whole project'],
  [` @${own}`, 'the @ form the composer inserts'],
  [` ${own}`, 'the project name alone'],
  [' .', 'explicit root'],
  [' @no-such-directory', 'genuinely missing'],
  [' ..', 'outside the project'],
]

for (const [raw, label] of cases) {
  const r = resolveScope(cwd, raw)
  const status = r.error === undefined ? `OK  scope=${r.scope}` : 'ERR'
  console.log(`\n/init${raw}   (${label})`)
  console.log(`  ${status}`)
  if (r.error !== undefined) console.log(`  ${r.error.split('\n')[0]}`)
  else console.log(`  readRoot=${r.readRoot}`)
}

console.log(`\nnormalizePathArg(' @${own}') = ${JSON.stringify(normalizePathArg(` @${own}`))}`)
