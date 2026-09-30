/**
 * Reconstruct the session lineage tree from the durable store.
 *
 * Each session directory's log opens with a `session` header frame carrying
 * `parentSession` / `isSeeded` / `origin`, so the first zstd frame of every log
 * is enough to rebuild the exact parent/child shape the client list projects.
 * Titles are read from the projection cache when present.
 *
 * Usage: node session-tree.cjs [sessionsRoot] [storagesRoot]
 *        (defaults: $DSH_HOME/sessions and $DSH_HOME/storages, else ~/.dsh/...)
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')

/** The DSH home this tool inspects, unless the caller names its own roots. */
const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
  ? process.env.DSH_HOME
  : path.join(os.homedir(), '.dsh')

const sessionsRoot = process.argv[2] ?? path.join(dshHome, 'sessions')
const storagesRoot = process.argv[3] ?? path.join(dshHome, 'storages')

/** First header frame of one session log. */
function headerOf(file) {
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(64 * 1024)
  const read = fs.readSync(fd, buf, 0, buf.length, 0)
  fs.closeSync(fd)
  try {
    const text = zlib.zstdDecompressSync(buf.subarray(0, read)).toString('utf8')
    const line = text.split('\n').find(candidate => candidate.trim() !== '')
    return JSON.parse(line)
  } catch (error) {
    return { error: error.message }
  }
}

/** Cached title for one session, when the projection cache has one. */
function titleOf(id) {
  for (const candidate of [
    path.join(storagesRoot, 'session_projcache', 'sessions', `${id}.json`),
  ]) {
    try {
      const json = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      const values = json?.values ?? json?.projections ?? json
      const title = values?.title?.value ?? values?.title
      if (typeof title === 'string' && title !== '') return title
    } catch (error) {
      /* absent cache is normal */
    }
  }
  return null
}

const rows = []
for (const cwdDir of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
  if (!cwdDir.isDirectory()) continue
  const cwdPath = path.join(sessionsRoot, cwdDir.name)
  for (const sessionDir of fs.readdirSync(cwdPath, { withFileTypes: true })) {
    if (!sessionDir.isDirectory()) continue
    const dir = path.join(cwdPath, sessionDir.name)
    const log = fs.readdirSync(dir).find(name => name.endsWith('.zstd'))
    if (log === undefined) continue
    const header = headerOf(path.join(dir, log))
    rows.push({
      id: sessionDir.name,
      cwd: cwdDir.name,
      parent: header.parentSession ?? null,
      seeded: header.isSeeded === true,
      origin: header.origin ?? null,
      preset: header.agentPreset ?? null,
      created: header.createdAt ?? null,
      title: titleOf(sessionDir.name),
    })
  }
}

const byId = new Map(rows.map(row => [row.id, row]))
const childrenOf = new Map()
for (const row of rows) {
  if (row.parent === null) continue
  const bucket = childrenOf.get(row.parent) ?? []
  bucket.push(row.id)
  childrenOf.set(row.parent, bucket)
}

/** Mark delegation-shaped ids the same way the plugin does. */
const BARE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const delegated = row => row.origin === 'subagent' || BARE_UUID.test(row.id)

const seen = new Set()
function walk(id, depth) {
  if (seen.has(id)) return
  seen.add(id)
  const row = byId.get(id)
  if (row === undefined) return
  const pad = '  '.repeat(depth)
  const tag = row.seeded ? 'seeded' : 'root  '
  const dele = delegated(row) ? ' DELEGATED' : ''
  console.log(`${pad}- [${tag}]${dele} ${id}`)
  console.log(`${pad}    title: ${row.title ?? '(none)'}`)
  for (const kid of childrenOf.get(id) ?? []) walk(kid, depth + 1)
}

console.log(`sessions: ${rows.length}`)
for (const row of rows.filter(candidate => candidate.parent === null)) walk(row.id, 0)
const orphans = rows.filter(row => row.parent !== null && !byId.has(row.parent))
for (const row of orphans) {
  console.log(`- [ORPHAN parent=${row.parent}] ${row.id}  title: ${row.title ?? '(none)'}`)
}
console.log('--- delegated sessions ---')
for (const row of rows.filter(delegated)) {
  console.log(`- ${row.id}  parent: ${row.parent ?? '(none)'}  title: ${row.title ?? '(none)'}`)
}
