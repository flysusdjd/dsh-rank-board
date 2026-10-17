/**
 * Host half of dsh-rank-board.
 *
 * The browser page cannot call api.npmjs.org directly (CORS) and must not wait
 * for hundreds of npm requests, so the host owns the crawl: it pulls the
 * community catalog, asks npm for install counts, caches the ranking on disk,
 * and serves it as one small JSON document on the official web port.
 *
 * npm's download API throttles hard (429) and refuses scoped names in bulk, so
 * the crawl is shortlist-based: candidates are ranked by the 30-day counts the
 * catalog already carries, only the top CANDIDATE_LIMIT are asked for live
 * numbers, and a deadline stops the scoped tail instead of stalling the page.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Cordis plugin name. The bundle patch id matches this. */
export const name = 'rank-board-host'

/** Only the web port is required; the profile dir is read opportunistically. */
export const inject = ['webServer']

const PREFIX = '/.dsh-rank-board'
/** Community catalog: 5,700+ entries, of which ~2,600 carry an npm package name. */
const CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'
const NPM_POINT = 'https://api.npmjs.org/downloads/point'
const WINDOWS = ['last-day', 'last-week', 'last-month']
const DEFAULT_WINDOW = 'last-week'
/** npm rejects bulk lookups above this size: {"error":"exceeded max bulk size of 128"}. */
const BULK_MAX = 128
/** Space between bulk calls: bursts get 429 instead of data. */
const CHUNK_GAP_MS = 1200
/** Scoped packages cannot be bulk-queried at all, so they get their own pool. */
const SCOPED_CONCURRENCY = 4
const SCOPED_GAP_MS = 250
/** Live lookups are limited to the catalog's own top names (see the header). */
const CANDIDATE_LIMIT = 400
/** Give up on the scoped tail after this long; partial boards beat frozen pages. */
const LIVE_DEADLINE_MS = 120 * 1000
/** Rows kept in memory, on disk, and in one response. */
const MAX_ROWS = 200
/** Re-crawl on open once the cached board is older than this. */
const STALE_MS = 6 * 60 * 60 * 1000
/** Per-package counts are reused across crawls for this long, so partial runs converge. */
const COUNTS_TTL_MS = 24 * 60 * 60 * 1000
const USER_AGENT = 'dsh-rank-board/0.1.0'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Fetch JSON, waiting out 429/5xx and network blips instead of losing the chunk. */
async function fetchJson(url, tries = 4) {
  let lastError
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(30000),
      })
      if (response.status === 429 || response.status === 503) {
        const retryAfter = Number(response.headers.get('retry-after'))
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 5000)
        continue
      }
      if (!response.ok) throw new Error(`${response.status} ${url}`)
      return await response.json()
    } catch (error) {
      lastError = error
      await sleep(1500 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`request failed: ${url}`)
}

/**
 * Catalog descriptions are localized objects ({ en, zh }); flatten one string so
 * the board has something to show under every package name.
 */
function descriptionText(value) {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return ''
  for (const key of ['zh', 'en']) {
    if (typeof value[key] === 'string' && value[key].trim() !== '') return value[key].trim()
  }
  return ''
}

/**
 * npm name -> catalog metadata. Duplicates keep the first entry. `prior` is the
 * 30-day count the catalog ships with; it is only a ranking prior for picking the
 * shortlist, never a number shown as if it were live.
 */
async function buildCatalog() {
  const data = await fetchJson(CATALOG_URL)
  const plugins = Array.isArray(data?.plugins) ? data.plugins : []
  const entries = new Map()
  for (const plugin of plugins) {
    const npmName = typeof plugin?.npm === 'string' ? plugin.npm.trim() : ''
    if (npmName === '' || entries.has(npmName)) continue
    entries.set(npmName, {
      name: npmName,
      owner: typeof plugin.owner === 'string' ? plugin.owner : '',
      description: descriptionText(plugin.description),
      category: typeof plugin.category === 'string' ? plugin.category : '',
      version: typeof plugin.version === 'string' ? plugin.version : '',
      prior: typeof plugin.downloads === 'number' && plugin.downloads > 0 ? plugin.downloads : 0,
      install: typeof plugin.install === 'string' && plugin.install !== ''
        ? plugin.install
        : `dsh plugin --profile desktop add ${npmName}`,
    })
  }
  return entries
}

/**
 * Install counts for one window over the shortlist. Unscoped names travel in
 * bulk batches; scoped names (`@scope/pkg`) are refused by bulk and are queried
 * one by one until the deadline. Returns whatever landed plus whether the tail
 * was cut short.
 */
async function countDownloads(shortlist, window, progress, deadline, total, onPartial) {
  const counts = new Map()
  const unscoped = []
  const scoped = []
  for (const entry of shortlist) {
    if (entry.name.startsWith('@')) scoped.push(entry.name)
    else unscoped.push(entry.name)
  }
  progress.phase = 'downloads'
  progress.total = typeof total === 'number' ? total : shortlist.length

  /** One bulk call; returns false when npm refused it or it carried no data. */
  const bulkInto = async (chunkNames) => {
    try {
      const data = await fetchJson(`${NPM_POINT}/${window}/${chunkNames.join(',')}`, 5)
      if (data === null || typeof data !== 'object') return false
      let landed = 0
      for (const [npmName, value] of Object.entries(data)) {
        if (value !== null && typeof value === 'object' && typeof value.downloads === 'number') {
          counts.set(npmName, value.downloads)
          landed += 1
        }
      }
      return landed > 0
    } catch {
      return false
    }
  }

  // A 429 on a 128-name batch must not cost 128 rows: halve and retry instead.
  const bulkFetch = async (chunkNames, depth) => {
    if (await bulkInto(chunkNames)) return
    if (chunkNames.length <= 8 || depth <= 0) return
    const half = Math.ceil(chunkNames.length / 2)
    await sleep(800)
    await bulkFetch(chunkNames.slice(0, half), depth - 1)
    await sleep(800)
    await bulkFetch(chunkNames.slice(half), depth - 1)
  }

  for (let at = 0; at < unscoped.length; at += BULK_MAX) {
    const chunk = unscoped.slice(at, at + BULK_MAX)
    await bulkFetch(chunk, 2)
    progress.done += chunk.length
    if (at + BULK_MAX < unscoped.length) await sleep(CHUNK_GAP_MS)
  }

  // Bulk names land in seconds; show them while the scoped tail is still going.
  if (typeof onPartial === 'function' && counts.size > 0) onPartial(counts)

  let cursor = 0
  let stopped = false
  const worker = async () => {
    for (;;) {
      if (stopped || Date.now() > deadline) {
        stopped = true
        return
      }
      const at = cursor
      cursor += 1
      if (at >= scoped.length) return
      const npmName = scoped[at]
      try {
        const data = await fetchJson(`${NPM_POINT}/${window}/${npmName}`, 2)
        if (typeof data?.downloads === 'number') counts.set(npmName, data.downloads)
      } catch {
        // A 404 here means "npm has no count for it", not "the plugin was deleted".
      }
      progress.done += 1
      await sleep(SCOPED_GAP_MS)
    }
  }
  await Promise.all(Array.from({ length: SCOPED_CONCURRENCY }, worker))
  return { counts, stopped }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Profile directory, so the cache survives restarts. Falls back to cwd. */
function profileDirectory(ctx) {
  try {
    const profile = ctx.get('profileContext')
    if (profile !== null && typeof profile === 'object' && typeof profile.dir === 'string' && profile.dir !== '') {
      return profile.dir
    }
  } catch {
    // No profile service: cwd is still writable.
  }
  return process.cwd()
}

const byDownloads = (left, right) => right.downloads - left.downloads || left.name.localeCompare(right.name)

/** @param ctx - host services named in {@link inject}. */
export function apply(ctx, config = {}) {
  const profileDir = profileDirectory(ctx)
  const cacheDir = join(profileDir, '.dsh-rank-board')
  const boards = new Map()
  const progress = new Map()
  const runners = new Map()

  const cachePath = (window) => join(cacheDir, `board-${window}.json`)
  const countsPath = (window) => join(cacheDir, `counts-${window}.json`)

  function readCache(window) {
    try {
      const raw = JSON.parse(readFileSync(cachePath(window), 'utf8'))
      // `basis` marks a board written by this version; older shapes are re-crawled.
      if (raw !== null && typeof raw === 'object' && Array.isArray(raw.rows) && typeof raw.basis === 'string') return raw
    } catch {
      // Missing or unreadable cache is just a cold start.
    }
    return undefined
  }

  function writeCache(board) {
    try {
      mkdirSync(cacheDir, { recursive: true })
      const tmp = `${cachePath(board.window)}.tmp`
      writeFileSync(tmp, JSON.stringify(board))
      renameSync(tmp, cachePath(board.window))
    } catch (error) {
      console.error(`dsh-rank-board: cannot write cache: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const window of WINDOWS) {
    const cached = readCache(window)
    if (cached !== undefined) boards.set(window, cached)
  }

  /** name -> [downloads, fetchedAt]. Kept across crawls of the same window. */
  function readCounts(window) {
    try {
      const raw = JSON.parse(readFileSync(countsPath(window), 'utf8'))
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) return raw
    } catch {
      // Cold start: nothing known yet.
    }
    return {}
  }

  function writeCounts(window, counts) {
    try {
      mkdirSync(cacheDir, { recursive: true })
      const tmp = `${countsPath(window)}.tmp`
      writeFileSync(tmp, JSON.stringify(counts))
      renameSync(tmp, countsPath(window))
    } catch (error) {
      console.error(`dsh-rank-board: cannot write counts: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** One crawl at a time per window; callers share the in-flight promise. */
  function refresh(window) {
    const running = runners.get(window)
    if (running !== undefined) return running
    const state = { running: true, phase: 'catalog', done: 0, total: 0, startedAt: Date.now(), error: '' }
    progress.set(window, state)
    const task = (async () => {
      try {
        const catalog = await buildCatalog()
        const shortlist = [...catalog.values()]
          .sort((left, right) => right.prior - left.prior || left.name.localeCompare(right.name))
          .slice(0, CANDIDATE_LIMIT)

        // Counts fetched recently are reused, so a deadline-truncated crawl is
        // completed by the next refresh instead of starting from zero again.
        const stored = readCounts(window)
        const now = Date.now()
        const known = new Map()
        const missing = []
        for (const entry of shortlist) {
          const hit = stored[entry.name]
          if (Array.isArray(hit) && typeof hit[0] === 'number' && typeof hit[1] === 'number'
            && now - hit[1] < COUNTS_TTL_MS) {
            known.set(entry.name, hit[0])
          } else {
            missing.push(entry)
          }
        }
        const rowOf = ({ prior, ...entry }) => entry

        /** Build, cache, and serve a board from whatever counts are known. */
        function publish(knownCounts) {
          const rows = []
          for (const entry of shortlist) {
            const downloads = knownCounts.get(entry.name)
            if (typeof downloads !== 'number') continue
            rows.push({ ...entry, downloads })
          }
          rows.sort(byDownloads)
          let board
          if (rows.length === 0) {
            // npm refused every call (typically a hard 429 window). Show the
            // catalog's own 30-day counts, clearly labelled, instead of nothing.
            board = {
              window,
              updatedAt: new Date().toISOString(),
              candidates: catalog.size,
              shortlist: shortlist.length,
              resolved: 0,
              unresolved: shortlist.length,
              basis: 'catalog',
              partial: true,
              rows: shortlist.filter((entry) => entry.prior > 0)
                .map((entry) => rowOf({ ...entry, downloads: entry.prior }))
                .slice(0, MAX_ROWS),
            }
          } else {
            board = {
              window,
              updatedAt: new Date().toISOString(),
              candidates: catalog.size,
              shortlist: shortlist.length,
              resolved: rows.length,
              unresolved: shortlist.length - rows.length,
              basis: 'live',
              partial: rows.length < shortlist.length,
              rows: rows.slice(0, MAX_ROWS).map(rowOf),
            }
          }
          writeCache(board)
          boards.set(window, board)
        }

        state.done = shortlist.length - missing.length
        const merge = (counts) => {
          for (const [npmName, downloads] of counts) {
            known.set(npmName, downloads)
            stored[npmName] = [downloads, now]
          }
        }
        const { counts } = await countDownloads(missing, window, state, now + LIVE_DEADLINE_MS, shortlist.length, (partial) => {
          publish(new Map([...known, ...partial]))
        })
        merge(counts)
        writeCounts(window, stored)
        publish(known)
        state.error = ''
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error)
        console.error(`dsh-rank-board: refresh failed: ${state.error}`)
      } finally {
        state.running = false
        state.phase = 'done'
        runners.delete(window)
      }
    })()
    runners.set(window, task)
    return task
  }

  function boardFor(window) {
    const board = boards.get(window)
    const state = progress.get(window)
    return {
      ok: true,
      window,
      updatedAt: board === undefined ? '' : board.updatedAt ?? '',
      candidates: board === undefined ? 0 : board.candidates ?? 0,
      shortlist: board === undefined ? 0 : board.shortlist ?? 0,
      resolved: board === undefined ? 0 : board.resolved ?? 0,
      unresolved: board === undefined ? 0 : board.unresolved ?? 0,
      basis: board === undefined ? 'none' : board.basis ?? 'live',
      partial: board === undefined ? false : board.partial === true,
      rows: board === undefined ? [] : board.rows,
      progress: state === undefined
        ? { running: false, phase: 'idle', done: 0, total: 0, error: '' }
        : state,
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    const method = req.method ?? 'GET'
    const requested = url.searchParams.get('window') ?? DEFAULT_WINDOW
    const window = WINDOWS.includes(requested) ? requested : DEFAULT_WINDOW

    if (url.pathname === `${PREFIX}/board`) {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      sendJson(res, 200, boardFor(window))
      return
    }
    if (url.pathname === `${PREFIX}/refresh`) {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'method-not-allowed' })
        return
      }
      void refresh(window)
      sendJson(res, 202, boardFor(window))
      return
    }
    sendJson(res, 404, { error: 'not-found', path })
  }

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => handle(req, res).catch((error) => {
      if (res.headersSent) {
        res.end()
        return
      }
      console.error(`dsh-rank-board: route failed: ${error instanceof Error ? error.message : String(error)}`)
      sendJson(res, 500, { error: 'internal-error' })
    }),
  })

  // Cold or stale cache: crawl in the background so the first page load is instant.
  const staleBefore = Date.now() - STALE_MS
  const warm = WINDOWS.filter((window) => {
    const board = boards.get(window)
    if (board === undefined) return window === DEFAULT_WINDOW
    const stamp = Date.parse(board.updatedAt)
    return !Number.isFinite(stamp) || stamp < staleBefore
  })
  if (config.autoRefresh !== false && warm.length > 0) {
    const timer = setTimeout(() => {
      for (const window of warm) void refresh(window)
    }, 5000)
    timer.unref?.()
  }

  return () => {
    try {
      dispose?.()
    } catch {
      // Already disposed by the loader.
    }
  }
}
