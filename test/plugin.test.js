import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject, name } from '../lib/index.js'

const PREFIX = '/.dsh-rank-board'

/** Host half with a stub webServer and a throwaway profile directory. */
function start(profileDir) {
  let route
  const ctx = {
    get: (key) => (key === 'profileContext' ? { dir: profileDir } : undefined),
    webServer: {
      register: (spec) => {
        route = spec
        return () => {}
      },
    },
  }
  const dispose = apply(ctx, { autoRefresh: false })
  assert.equal(route.kind, 'prefix')
  return { route, dispose }
}

/** Minimal ServerResponse: captures status/headers and resolves with parsed JSON. */
function call(route, method, path) {
  return new Promise((resolve, reject) => {
    const res = {
      status: 0,
      headers: {},
      body: '',
      headersSent: false,
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
        this.headersSent = true
      },
      end(chunk = '') {
        this.body += chunk
        resolve({ status: this.status, headers: this.headers, body: JSON.parse(this.body) })
      },
    }
    Promise.resolve(route.handler({ method, url: path }, res)).catch(reject)
  })
}

async function waitForBoard(route, predicate) {
  const deadline = Date.now() + 3000
  for (;;) {
    const response = await call(route, 'GET', `${PREFIX}/board?window=last-week`)
    if (predicate(response.body)) return response.body
    if (Date.now() > deadline) throw new Error(`board never settled: ${JSON.stringify(response.body.progress)}`)
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

const mockResponse = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => body,
})

test('exports the Cordis contract', () => {
  assert.equal(name, 'rank-board-host')
  assert.deepEqual(inject, ['webServer'])
  assert.equal(typeof apply, 'function')
})

test('serves an empty board before the first crawl', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-rank-board-'))
  const { route, dispose } = start(dir)
  try {
    const response = await call(route, 'GET', `${PREFIX}/board?window=last-week`)
    assert.equal(response.status, 200)
    assert.equal(response.body.ok, true)
    assert.equal(response.body.basis, 'none')
    assert.deepEqual(response.body.rows, [])
    assert.deepEqual(response.body.progress, { running: false, phase: 'idle', done: 0, total: 0, error: '' })

    const fallback = await call(route, 'GET', `${PREFIX}/board?window=bogus`)
    assert.equal(fallback.body.window, 'last-week')
  } finally {
    dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects unsupported methods and unknown paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-rank-board-'))
  const { route, dispose } = start(dir)
  try {
    assert.equal((await call(route, 'POST', `${PREFIX}/board`)).status, 405)
    assert.equal((await call(route, 'GET', `${PREFIX}/refresh`)).status, 405)
    assert.equal((await call(route, 'GET', `${PREFIX}/missing`)).status, 404)
  } finally {
    dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('crawls catalog + npm, flattens descriptions, and reuses counts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-rank-board-'))
  const { route, dispose } = start(dir)
  const originalFetch = globalThis.fetch
  let npmCalls = 0

  globalThis.fetch = async (url) => {
    const target = String(url)
    if (target.includes('plugins.json')) {
      return mockResponse({
        plugins: [
          {
            npm: 'alpha',
            owner: 'alice',
            description: { zh: '阿尔法插件', en: 'alpha plugin' },
            category: 'ui',
            version: '1.0.0',
            downloads: 100,
            install: 'dsh plugin --profile web add alpha',
          },
          {
            npm: 'beta',
            owner: 'bob',
            description: { en: 'beta plugin only' },
            category: 'tools',
            version: '2.0.0',
            downloads: 50,
          },
          { npm: null, description: { zh: '没有 npm 包' } },
        ],
      })
    }
    if (target.includes('/downloads/point/')) {
      npmCalls += 1
      return mockResponse({ alpha: { downloads: 420 }, beta: { downloads: 70 } })
    }
    throw new Error(`unexpected fetch: ${target}`)
  }

  try {
    const accepted = await call(route, 'POST', `${PREFIX}/refresh?window=last-week`)
    assert.equal(accepted.status, 202)

    const board = await waitForBoard(route, (value) => value.progress.running === false && value.resolved > 0)
    assert.equal(board.basis, 'live')
    assert.equal(board.candidates, 2)
    assert.equal(board.shortlist, 2)
    assert.equal(board.resolved, 2)
    assert.equal(board.rows.length, 2)

    const [first, second] = board.rows
    assert.equal(first.name, 'alpha')
    assert.equal(first.downloads, 420)
    assert.equal(first.description, '阿尔法插件')
    assert.equal(first.install, 'dsh plugin --profile web add alpha')
    assert.equal(second.name, 'beta')
    assert.equal(second.description, 'beta plugin only')
    // Missing catalog install text falls back to the desktop profile command.
    assert.equal(second.install, 'dsh plugin --profile desktop add beta')

    assert.equal(npmCalls, 1)
    assert.ok(existsSync(join(dir, '.dsh-rank-board', 'board-last-week.json')))
    assert.ok(existsSync(join(dir, '.dsh-rank-board', 'counts-last-week.json')))

    // A second refresh inside the counts TTL must not hit npm again.
    await call(route, 'POST', `${PREFIX}/refresh?window=last-week`)
    const again = await waitForBoard(route, (value) => value.progress.running === false && value.resolved > 0)
    assert.equal(again.rows[0].name, 'alpha')
    assert.equal(npmCalls, 1)
  } finally {
    globalThis.fetch = originalFetch
    dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('client bundle registers the 插件榜单 settings section', () => {
  const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let spec
  globalThis.window = { __ModuleLoader__: { load: (value) => { spec = value } } }
  try {
    new Function('window', code)(globalThis.window)
    assert.equal(spec.id, 'dsh-rank-board')

    const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
    const exported = spec.factory(() => React)
    assert.deepEqual(exported.inject, ['slots'])
    assert.equal(typeof exported.apply, 'function')

    let section
    let component
    exported.apply({
      slots: {
        inject: (_slot, register) => register(),
        register: (value, view) => { section = value; component = view },
      },
    })
    assert.equal(section.id, 'rank-board')
    assert.equal(section.label(), '插件榜单')
    assert.equal(typeof component, 'function')
  } finally {
    delete globalThis.window
  }
})
