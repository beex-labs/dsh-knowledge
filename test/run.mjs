/**
 * Run every test file in this directory.
 *
 * Deliberately a plain script rather than a test framework: the plugin ships
 * inside a DSH profile with no dev dependencies of its own, so `node --test`
 * or a runner package would be a dependency the plugin cannot install. Each
 * test file is a standalone program that exits non-zero on failure.
 *
 * Usage: node test/run.mjs
 */

import { spawn } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const entries = await readdir(here)
const files = entries.filter((entry) => entry.endsWith('.test.mjs')).sort()

if (files.length === 0) {
  console.error('no *.test.mjs files found')
  process.exit(1)
}

/** Run one test file, streaming its output. */
function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, file)], { stdio: 'inherit', cwd: join(here, '..') })
    child.on('close', (code) => resolve({ file, code: code ?? 1 }))
  })
}

const results = []
for (const file of files) {
  console.log(`\n=== ${file} ===`)
  results.push(await run(file))
}

const failed = results.filter((result) => result.code !== 0)
console.log(`\n${'='.repeat(40)}`)
for (const result of results) console.log(`${result.code === 0 ? 'PASS' : 'FAIL'}  ${result.file}`)
console.log(`${results.length - failed.length}/${results.length} test files passed`)
process.exit(failed.length === 0 ? 0 : 1)
