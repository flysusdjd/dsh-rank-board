window.__ModuleLoader__.load({
  id: 'dsh-rank-board',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    /** `h` keeps this file JSX-free: bundle clients are plain scripts. */
    const h = (tag, props, ...children) => React.createElement(tag, props, ...children)

    const WINDOWS = [
      { id: 'last-day', label: '日榜' },
      { id: 'last-week', label: '周榜' },
      { id: 'last-month', label: '月榜' },
    ]
    const STYLE_ID = 'dsh-rank-board-style'

    const STYLE = `
.dsh-rb { display: flex; flex-direction: column; gap: 14px; color: inherit; }
.dsh-rb-head { display: flex; flex-direction: column; gap: 4px; }
.dsh-rb-title { margin: 0; font-size: 18px; font-weight: 600; }
.dsh-rb-sub { margin: 0; font-size: 12px; line-height: 1.5; opacity: .62; }
.dsh-rb-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-rb-tabs { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: rgba(127,127,127,.12); }
.dsh-rb-tab { border: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 6px; cursor: pointer; opacity: .72; }
.dsh-rb-tab.is-on { background: rgba(127,127,127,.26); opacity: 1; }
.dsh-rb-tab:disabled { cursor: default; opacity: .4; }
.dsh-rb-meta { font-size: 12px; opacity: .55; }
.dsh-rb-spacer { flex: 1 1 auto; }
.dsh-rb-btn { border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 6px; cursor: pointer; }
.dsh-rb-btn:hover:not(:disabled) { background: rgba(127,127,127,.14); }
.dsh-rb-btn:disabled { cursor: default; opacity: .45; }
.dsh-rb-progress { height: 3px; border-radius: 2px; overflow: hidden; background: rgba(127,127,127,.16); }
.dsh-rb-progress > i { display: block; height: 100%; border-radius: 2px; background: var(--dsw-alias-button-info-fill, #2f6fed); transition: width .4s ease; }
.dsh-rb-list { display: flex; flex-direction: column; border-radius: 10px; overflow: hidden; border: 1px solid rgba(127,127,127,.22); }
.dsh-rb-row { display: grid; grid-template-columns: 34px minmax(0, 1.5fr) minmax(0, 1fr) 92px; align-items: center; gap: 10px; padding: 8px 12px; font-size: 13px; cursor: pointer; }
.dsh-rb-row + .dsh-rb-row { border-top: 1px solid rgba(127,127,127,.14); }
.dsh-rb-row:nth-child(odd) { background: rgba(127,127,127,.045); }
.dsh-rb-row:hover { background: rgba(127,127,127,.09); }
.dsh-rb-row:focus-visible { outline: 2px solid var(--dsw-alias-button-info-fill, #2f6fed); outline-offset: -2px; }
.dsh-rb-rank { font-variant-numeric: tabular-nums; font-weight: 600; opacity: .45; text-align: right; }
.dsh-rb-row:nth-child(-n+3) .dsh-rb-rank { opacity: 1; color: var(--dsw-alias-button-info-fill, #2f6fed); }
.dsh-rb-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-rb-npm { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-rb-desc { font-size: 11.5px; opacity: .55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-rb-bar-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-rb-bar-fill { flex: 1 1 auto; height: 6px; border-radius: 3px; background: rgba(127,127,127,.14); overflow: hidden; }
.dsh-rb-bar-fill > i { display: block; height: 100%; border-radius: 3px; background: var(--dsw-alias-button-info-fill, #2f6fed); opacity: .75; }
.dsh-rb-count { font-variant-numeric: tabular-nums; font-size: 12.5px; min-width: 62px; text-align: right; }
.dsh-rb-owner { font-size: 12px; opacity: .55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right; }
.dsh-rb-empty { padding: 22px 12px; text-align: center; font-size: 13px; opacity: .6; }
.dsh-rb-note { font-size: 11.5px; line-height: 1.6; opacity: .5; }
.dsh-rb-error { color: var(--dsw-alias-state-error-primary, #d33); font-size: 12.5px; }
.dsh-rb-toast { font-size: 12px; color: var(--dsw-alias-button-info-fill, #2f6fed); }
.dsh-rb-banner { margin: 0; padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5; background: rgba(127,127,127,.12); opacity: .8; }
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      let node = document.getElementById(STYLE_ID)
      if (node === null) {
        node = document.createElement('style')
        node.id = STYLE_ID
        document.head.append(node)
      }
      if (node.textContent !== STYLE) node.textContent = STYLE
    }

    async function request(path, options) {
      const response = await fetch(path, {
        cache: 'no-store',
        ...options,
        headers: {
          accept: 'application/json',
          ...(options && options.headers ? options.headers : {}),
        },
      })
      const text = await response.text()
      let body = null
      if (text !== '') {
        try {
          body = JSON.parse(text)
        } catch {
          body = { error: text.slice(0, 200) }
        }
      }
      if (!response.ok) {
        const message = body !== null && typeof body === 'object' && typeof body.error === 'string'
          ? body.error
          : `HTTP ${response.status}`
        throw new Error(message)
      }
      return body
    }

    function formatCount(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
      if (value >= 10000) return `${(value / 1000).toFixed(0)}k`
      return value.toLocaleString('zh-CN')
    }

    function formatStamp(iso) {
      if (typeof iso !== 'string' || iso === '') return '尚未抓取'
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return '尚未抓取'
      const date = new Date(at)
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    const EMPTY_BOARD = {
      window: 'last-week',
      updatedAt: '',
      candidates: 0,
      shortlist: 0,
      resolved: 0,
      unresolved: 0,
      basis: 'none',
      partial: false,
      rows: [],
      progress: { running: false, phase: 'idle', done: 0, total: 0, error: '' },
    }

    function RankSection() {
      const [windowId, setWindowId] = React.useState('last-week')
      const [board, setBoard] = React.useState(EMPTY_BOARD)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState('')
      const [toast, setToast] = React.useState('')
      const mounted = React.useRef(true)

      React.useEffect(() => {
        ensureStyle()
        return () => { mounted.current = false }
      }, [])

      const warmed = React.useRef(new Set())
      const load = React.useCallback(async () => {
        try {
          const next = await request(`/.dsh-rank-board/board?window=${encodeURIComponent(windowId)}`)
          if (!mounted.current || next === null || typeof next !== 'object') return undefined
          setBoard({ ...EMPTY_BOARD, ...next })
          setError('')
          return next
        } catch (failure) {
          if (!mounted.current) return undefined
          setError(failure instanceof Error ? failure.message : String(failure))
          return undefined
        } finally {
          if (mounted.current) setLoading(false)
        }
      }, [windowId])

      // Opening a window that has no cache yet starts its crawl immediately,
      // instead of asking the user to click 刷新 on every tab.
      React.useEffect(() => {
        mounted.current = true
        setLoading(true)
        void load().then((next) => {
          if (next === undefined || !mounted.current) return
          const idle = next.progress === undefined || next.progress.running !== true
          if (next.basis !== 'none' || !idle || warmed.current.has(windowId)) return
          warmed.current.add(windowId)
          void request(`/.dsh-rank-board/refresh?window=${encodeURIComponent(windowId)}`, { method: 'POST' })
            .then(() => load())
            .catch(() => undefined)
        })
      }, [load, windowId])

      const running = board.progress !== undefined && board.progress.running === true
      React.useEffect(() => {
        if (!running) return undefined
        const timer = setInterval(() => { void load() }, 2000)
        return () => { clearInterval(timer) }
      }, [running, load])

      React.useEffect(() => {
        if (!running && board.progress !== undefined && board.progress.error !== '') {
          setError(board.progress.error)
        }
      }, [running, board.progress])

      async function startRefresh() {
        setToast('')
        try {
          await request(`/.dsh-rank-board/refresh?window=${encodeURIComponent(windowId)}`, { method: 'POST' })
          void load()
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }

      async function copyInstall(row) {
        const command = typeof row.install === 'string' && row.install !== ''
          ? row.install
          : `dsh plugin add ${row.name}`
        try {
          await navigator.clipboard.writeText(command)
          setToast(`已复制：${command}`)
        } catch {
          setToast(`安装命令：${command}`)
        }
      }

      const rows = Array.isArray(board.rows) ? board.rows : []
      const top = rows.length > 0 && typeof rows[0].downloads === 'number' ? rows[0].downloads : 0
      const progress = board.progress !== undefined ? board.progress : EMPTY_BOARD.progress
      const percent = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0

      return h('div', { className: 'dsh-rb' },
        h('div', { className: 'dsh-rb-head' },
          h('h2', { className: 'dsh-rb-title' }, '插件榜单'),
          h('p', { className: 'dsh-rb-sub' },
            '按 npm 官方下载统计排名的 DSH 插件榜。目录覆盖社区精选列表里的全部插件，数据由本机直接向 npm 抓取。'),
        ),
        h('div', { className: 'dsh-rb-bar' },
          h('div', { className: 'dsh-rb-tabs' },
            ...WINDOWS.map((entry) => h('button', {
              key: entry.id,
              type: 'button',
              className: `dsh-rb-tab${entry.id === windowId ? ' is-on' : ''}`,
              disabled: loading,
              onClick: () => { setWindowId(entry.id) },
            }, entry.label)),
          ),
          h('span', { className: 'dsh-rb-meta' },
            `${formatStamp(board.updatedAt)} · 实时 ${board.resolved}/${board.shortlist} 个候选 · 目录共 ${board.candidates} 个`),
          h('span', { className: 'dsh-rb-spacer' }),
          toast !== '' ? h('span', { className: 'dsh-rb-toast' }, toast) : null,
          h('button', {
            type: 'button',
            className: 'dsh-rb-btn',
            disabled: running || loading,
            onClick: () => { void startRefresh() },
          }, running ? `抓取中 ${percent}%` : '刷新'),
        ),
        board.basis === 'catalog'
          ? h('p', { className: 'dsh-rb-banner' },
            'npm 接口正在限流（429），暂时显示社区目录自带的 30 天下载量，数字不是实时的。过一会儿点「刷新」可重试。')
          : null,
        board.basis === 'live' && board.partial && running === false
          ? h('p', { className: 'dsh-rb-banner' },
            `本次抓取在 ${board.resolved} 个候选处停止（npm 限流），排名仍取自实时下载量；再点「刷新」会补齐后面的候选。`)
          : null,
        running
          ? h('div', { className: 'dsh-rb-progress' }, h('i', { style: { width: `${percent}%` } }))
          : null,
        error !== '' ? h('p', { className: 'dsh-rb-error', role: 'alert' }, `加载失败：${error}`) : null,
        h('div', { className: 'dsh-rb-list' },
          rows.length === 0
            ? h('div', { className: 'dsh-rb-empty' },
              loading
                ? '正在读取榜单…'
                : running
                  ? '正在向 npm 抓取实时下载量（只查候选池，约 10–60 秒），抓完这里会自动刷新。'
                  : '还没有数据，点「刷新」抓一次。')
            : rows.map((row, index) => h('div', {
              key: row.name,
              className: 'dsh-rb-row',
              role: 'button',
              tabIndex: 0,
              title: row.description !== '' ? row.description : row.name,
              'aria-label': `复制安装命令：${row.name}`,
              onClick: () => { void copyInstall(row) },
              onKeyDown: (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                void copyInstall(row)
              },
            },
            h('span', { className: 'dsh-rb-rank' }, String(index + 1)),
            h('span', { className: 'dsh-rb-name' },
              h('span', { className: 'dsh-rb-npm' }, row.name),
              row.description !== ''
                ? h('span', { className: 'dsh-rb-desc' }, row.description)
                : null,
            ),
            h('span', { className: 'dsh-rb-bar-cell' },
              h('span', { className: 'dsh-rb-bar-fill' },
                h('i', { style: { width: `${top > 0 ? Math.max(2, Math.round((row.downloads / top) * 100)) : 0}%` } })),
              h('span', { className: 'dsh-rb-count' }, formatCount(row.downloads)),
            ),
            h('span', { className: 'dsh-rb-owner', title: row.owner }, row.owner),
            )),
        ),
        h('p', { className: 'dsh-rb-note' },
          '口径：下载量 = npm 统计的 tarball 下载次数，包含 CI、镜像同步和批量安装，不等于用户数。'
          + '只统计社区目录（awesome-dsh-plugin）收录的包，未收录的插件不会出现在榜上。'
          + '点任意一行可复制安装命令。'),
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'rank-board',
        order: 26,
        label: () => '插件榜单',
        inject: () => ({}),
      }, RankSection))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
