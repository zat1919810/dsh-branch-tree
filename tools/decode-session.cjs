/**
 * Decode every zstd frame of one DSH session log and summarize its event types.
 *
 * DSH appends one zstd frame per record, and Node's single-shot and streaming
 * zstd APIs both stop at the first frame, so this walks the concatenated chain
 * by locating candidate frame magics and validating each by decompressing it.
 *
 * Usage: node decode-session.cjs <session.v4.jsonl.zstd> [--max N]
 */
const fs = require('node:fs')
const zlib = require('node:zlib')

const [file] = process.argv.slice(2)
const buf = fs.readFileSync(file)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Candidate offsets of the zstd frame magic, ascending. */
const candidates = []
for (let i = 0; i + 4 <= buf.length; i += 1) {
  if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) candidates.push(i)
}

const records = []
let cursor = 0
while (cursor < buf.length) {
  // The first frame starts at the first magic; afterwards, take the next magic
  // that decompresses into parseable JSON.
  let advanced = false
  for (const offset of candidates) {
    if (offset < cursor) continue
    let text
    try {
      text = zlib.zstdDecompressSync(buf.subarray(offset)).toString('utf8')
    } catch {
      continue
    }
    const trimmed = text.trim()
    if (trimmed === '') continue
    let parsed = true
    for (const line of trimmed.split('\n')) {
      if (line.trim() === '') continue
      try {
        records.push(JSON.parse(line))
      } catch {
        parsed = false
      }
    }
    if (!parsed) continue
    cursor = offset + 1
    advanced = true
    break
  }
  if (!advanced) break
}

const types = new Map()
for (const record of records) {
  const type = record.type ?? '<none>'
  types.set(type, (types.get(type) ?? 0) + 1)
}

console.log(`file: ${file}`)
console.log(`bytes: ${buf.length}  candidate frames: ${candidates.length}  decoded records: ${records.length}`)
if (records.length > 0) {
  console.log(`first: ${JSON.stringify(records[0]).slice(0, 260)}`)
  const turns = records.filter(record => record.type === 'turn/end')
  console.log(`turn/end records: ${turns.length}${turns.length === 0 ? '' : ` (last seq: ${turns[turns.length - 1].seq})`}`)
  const starts = records.filter(record => record.type === 'turn/start')
  console.log(`turn/start records: ${starts.length}`)
  console.log('event types:')
  for (const [type, count] of [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${type}: ${count}`)
  }
}
