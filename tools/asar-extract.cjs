/**
 * Minimal asar reader: parse the archive header and extract one file by path.
 *
 * The header region length comes from the pickle preamble (uint32 at byte 4);
 * the JSON inside it is located by brace matching so a 4-byte pickle padding or
 * alignment difference cannot shift the parse. File offsets are relative to the
 * end of the header region.
 *
 * Usage: node asar-extract.cjs <archive.asar> <inner/path> [outFile]
 *        node asar-extract.cjs <archive.asar> --find <substring>
 */
const fs = require('node:fs')
const path = require('node:path')

const [archive, target, out] = process.argv.slice(2)
if (archive === undefined || target === undefined) {
  console.error('usage: node asar-extract.cjs <archive.asar> <inner/path|--find SUBSTRING> [outFile]')
  process.exit(2)
}

const fd = fs.openSync(archive, 'r')
const preamble = Buffer.alloc(8)
fs.readSync(fd, preamble, 0, 8, 0)
const regionSize = preamble.readUInt32LE(4)
const region = Buffer.alloc(regionSize)
fs.readSync(fd, region, 0, regionSize, 8)

/** Locate the JSON object inside the header region by brace matching. */
function locateJson(buf) {
  const start = buf.indexOf(0x7b) // '{'
  if (start < 0) throw new Error('no JSON object in asar header')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < buf.length; i += 1) {
    const byte = buf[i]
    if (inString) {
      if (escaped) escaped = false
      else if (byte === 0x5c) escaped = true
      else if (byte === 0x22) inString = false
      continue
    }
    if (byte === 0x22) inString = true
    else if (byte === 0x7b) depth += 1
    else if (byte === 0x7d) {
      depth -= 1
      if (depth === 0) return { start, end: i }
    }
  }
  throw new Error('unterminated JSON in asar header')
}

const { start, end } = locateJson(region)
const header = JSON.parse(region.subarray(start, end + 1).toString('utf8'))
const dataStart = 8 + regionSize

/** Depth-first walk yielding [innerPath, entry] for every file node. */
function* walk(node, prefix) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const inner = prefix === '' ? name : `${prefix}/${name}`
    if (entry.files !== undefined) yield* walk(entry, inner)
    else yield [inner, entry]
  }
}

if (target === '--find') {
  const needle = out ?? ''
  let count = 0
  const shown = []
  for (const [inner] of walk(header, '')) {
    if (!inner.includes(needle)) continue
    count += 1
    if (shown.length < 25) shown.push(inner)
  }
  for (const inner of shown) console.log(`  ${inner}`)
  console.log(`matches: ${count} (files: ${[...walk(header, '')].length}, regionSize: ${regionSize})`)
  process.exit(0)
}

const found = [...walk(header, '')].find(([inner]) => inner === target)
  ?? [...walk(header, '')].find(([inner]) => inner.endsWith(`/${target}`))
if (found === undefined) {
  console.error(`not found: ${target}`)
  process.exit(4)
}
const [inner, entry] = found
const buf = Buffer.alloc(entry.size)
fs.readSync(fd, buf, 0, entry.size, dataStart + Number(entry.offset))
if (out === undefined) process.stdout.write(buf.toString('utf8'))
else {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, buf)
  console.log(`extracted ${inner} (${entry.size} bytes) -> ${out}`)
}
fs.closeSync(fd)
