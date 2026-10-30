/**
 * terminal-stream — real-time market data bridge (port 3031)
 *
 * Subscribes to Binance public spot + futures WebSocket streams and REST
 * polling endpoints, aggregates them per symbol and pushes snapshots to the
 * browser via socket.io. All data is public market data, no API keys.
 *
 * Events emitted to clients:
 *  snapshot     full state on subscribe (klines, trades, ladder, futures...)
 *  trade        batched aggTrades [id, price, qty, ts, isBuyerMaker]
 *  depth        top-20 partial book (100ms)
 *  ladder-col   aggregated deep book snapshot for heatmap (1s)
 *  kline        1m kline update
 *  ticker       24h rolling window stats (1s)
 *  mark         futures mark price / funding (1s)
 *  oi           open interest (10s)
 *  liq          real liquidation event (forceOrder)
 *  status       upstream connection status
 */
import { createServer } from 'http'
import { Server } from 'socket.io'

const PORT = 3031
const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

interface Trade { a: number; p: number; q: number; t: number; m: boolean }
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
interface Level { p: number; q: number }
interface HeatCol { t: number; mid: number; bids: Level[]; asks: Level[] }
interface Liq { t: number; side: 'BUY' | 'SELL'; p: number; q: number }

interface SymbolState {
  symbol: string
  streams: number // client count that want this symbol
  spotWs?: WebSocket
  futWs?: WebSocket
  status: 'connecting' | 'live' | 'offline'
  lastError?: string
  trades: Trade[]                 // newest last, ring
  klines: Candle[]                // 1m, newest last
  ticker?: Record<string, number | string>
  depth?: { bids: Level[]; asks: Level[] } // top 20
  ladder?: { bids: Level[]; asks: Level[]; t: number } // deep REST book
  heatCols: HeatCol[]             // ring, oldest first
  mark?: { p: number; funding: number; nextFunding: number; index: number }
  oi?: { oi: number; t: number }
  liqs: Liq[]
  timers: ReturnType<typeof setInterval>[]
  lastSentTradeId: number
}

const S = new Map<string, SymbolState>()
const state = (symbol: string): SymbolState => {
  let s = S.get(symbol)
  if (!s) {
    s = { symbol, streams: 0, status: 'connecting', trades: [], klines: [], heatCols: [], liqs: [], timers: [], lastSentTradeId: 0 }
    S.set(symbol, s)
  }
  return s
}

const lc = (x: string) => x.toLowerCase()
const RING = (arr: any[], max: number) => { if (arr.length > max) arr.splice(0, arr.length - max) }

async function jget(url: string, timeoutMs = 8000): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(timer) }
}

// ---------------------------------------------------------------- upstream WS
function openSpotWs(s: SymbolState) {
  const sym = lc(s.symbol)
  const streams = [`${sym}@aggTrade`, `${sym}@depth20@100ms`, `${sym}@kline_1m`, `${sym}@ticker`].join('/')
  let retry = 0
  const connect = () => {
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
    s.spotWs = ws
    ws.onopen = () => { retry = 0; s.status = 'live'; s.lastError = undefined; broadcastStatus(s) }
    ws.onmessage = (ev) => { try { handleSpot(s, JSON.parse(ev.data as string)) } catch { /* ignore */ } }
    ws.onclose = () => {
      if (s.spotWs !== ws) return
      s.status = s.futWs && s.futWs.readyState === WebSocket.OPEN ? s.status : 'offline'
      retry++; setTimeout(connect, Math.min(15000, 800 * retry))
    }
    ws.onerror = () => { s.lastError = 'spot stream error' }
  }
  connect()
}

function openFutWs(s: SymbolState) {
  const sym = lc(s.symbol)
  const streams = [`${sym}@markPrice@1s`, `${sym}@forceOrder`].join('/')
  let retry = 0
  const connect = () => {
    const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${streams}`)
    s.futWs = ws
    ws.onmessage = (ev) => { try { handleFut(s, JSON.parse(ev.data as string)) } catch { /* ignore */ } }
    ws.onclose = () => {
      if (s.futWs !== ws) return
      retry++; setTimeout(connect, Math.min(15000, 800 * retry))
    }
  }
  connect()
}

function handleSpot(s: SymbolState, msg: any) {
  const d = msg.data
  if (!d) return
  if (d.e === 'aggTrade') {
    s.trades.push({ a: d.a, p: +d.p, q: +d.q, t: d.T, m: d.m })
    RING(s.trades, 6000)
    return
  }
  if (d.e === 'kline') {
    const k = d.k
    const c: Candle = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }
    const last = s.klines[s.klines.length - 1]
    if (last && last.t === c.t) s.klines[s.klines.length - 1] = c
    else if (!last || c.t > last.t) { s.klines.push(c); RING(s.klines, 1000) }
    return
  }
  if (d.e === '24hrTicker') {
    s.ticker = {
      c: +d.c, P: +d.P, h: +d.h, l: +d.l, v: +d.v, q: +d.q,
      b: +d.b, a: +d.a, O: d.O, C: d.C,
    }
    return
  }
  if (d.bids) { // partial book depth (no event type field)
    s.depth = { bids: d.bids.map((x: string[]) => ({ p: +x[0], q: +x[1] })), asks: d.asks.map((x: string[]) => ({ p: +x[0], q: +x[1] })) }
  }
}

function handleFut(s: SymbolState, msg: any) {
  const d = msg.data
  if (!d) return
  if (d.e === 'markPriceUpdate') {
    s.mark = { p: +d.p, funding: +d.r, nextFunding: +d.T, index: +d.i }
    return
  }
  if (d.e === 'forceOrder') {
    const o = d.o
    s.liqs.push({ t: o.T, side: o.S, p: +o.ap || +o.p, q: +o.q })
    RING(s.liqs, 300)
    io.emit('liq', { symbol: s.symbol, liq: s.liqs[s.liqs.length - 1] })
  }
}

// ---------------------------------------------------------------- REST polls
async function pollLadder(s: SymbolState) {
  try {
    const d = await jget(`https://api.binance.com/api/v3/depth?symbol=${s.symbol}&limit=500`)
    const bids: Level[] = [], asks: Level[] = []
    for (const x of d.bids) bids.push({ p: +x[0], q: +x[1] })
    for (const x of d.asks) asks.push({ p: +x[0], q: +x[1] })
    const t = Date.now()
    const mid = (bids[0].p + asks[0].p) / 2
    const col: HeatCol = { t, mid, bids, asks }
    s.ladder = { bids, asks, t }
    s.heatCols.push(col)
    RING(s.heatCols, 900) // 15 min @1s
    io.emit('ladder-col', { symbol: s.symbol, col })
  } catch { /* transient */ }
}

async function pollOi(s: SymbolState) {
  try {
    const d = await jget(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${s.symbol}`)
    s.oi = { oi: +d.openInterest, t: Date.now() }
    io.emit('oi', { symbol: s.symbol, oi: s.oi })
  } catch { /* transient */ }
}

async function loadHistory(s: SymbolState) {
  const [k, tr] = await Promise.all([
    jget(`https://api.binance.com/api/v3/klines?symbol=${s.symbol}&interval=1m&limit=1000`),
    jget(`https://api.binance.com/api/v3/aggTrades?symbol=${s.symbol}&limit=1000`).catch(() => []),
  ])
  s.klines = k.map((x: any[]) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }))
  // REST aggTrades returns objects: { a, p, q, f, l, T, m, M }
  s.trades = (Array.isArray(tr) ? tr : []).map((x: any) => ({ a: +x.a, p: +x.p, q: +x.q, t: +x.T, m: !!x.m }))
  s.trades.sort((a, b) => a.t - b.t)
  s.lastSentTradeId = s.trades.length ? s.trades[s.trades.length - 1].a : 0
}

async function pollMark(s: SymbolState) {
  // futures WS streams for markPrice are geo-restricted on some hosts, so poll REST
  try {
    const d = await jget(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s.symbol}`)
    s.mark = { p: +d.markPrice, funding: +d.lastFundingRate, nextFunding: +d.nextFundingTime, index: +d.indexPrice }
    io.emit('mark', { symbol: s.symbol, mark: s.mark })
  } catch { /* transient */ }
}

async function ensureSymbol(symbol: string) {
  const s = state(symbol)
  s.streams++
  if (s.timers.length) return // already running
  s.status = 'connecting'
  openSpotWs(s)
  openFutWs(s)
  // prime history before first snapshot
  try { await loadHistory(s) } catch { s.lastError = 'history load failed' }
  pollLadder(s); pollOi(s); pollMark(s)
  s.timers.push(setInterval(() => pollLadder(s), 1000))
  s.timers.push(setInterval(() => pollOi(s), 10000))
  s.timers.push(setInterval(() => pollMark(s), 5000))
}

function releaseSymbol(symbol: string) {
  const s = S.get(symbol)
  if (!s) return
  s.streams = Math.max(0, s.streams - 1)
  if (s.streams === 0) {
    setTimeout(() => {
      const cur = S.get(symbol)
      if (!cur || cur.streams > 0) return
      cur.spotWs?.close(); cur.futWs?.close()
      cur.timers.forEach(clearInterval)
      S.delete(symbol)
      console.log(`[terminal-stream] released ${symbol}`)
    }, 30_000)
  }
}

function snapshot(s: SymbolState) {
  return {
    symbol: s.symbol,
    serverTime: Date.now(),
    status: s.status,
    lastError: s.lastError ?? null,
    trades: s.trades.slice(-2500),
    klines: s.klines.slice(-1000),
    ticker: s.ticker ?? null,
    depth: s.depth ?? null,
    ladder: s.ladder ?? null,
    heatCols: s.heatCols.slice(-420),
    mark: s.mark ?? null,
    oi: s.oi ?? null,
    liqs: s.liqs.slice(-150),
  }
}

function broadcastStatus(s: SymbolState) {
  io.emit('status', { symbol: s.symbol, status: s.status, error: s.lastError ?? null })
}

// ---------------------------------------------------------------- socket api
io.on('connection', (socket) => {
  let current: string | null = null
  socket.on('subscribe', async (msg: { symbol?: string }) => {
    const symbol = (msg?.symbol || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!/^(BTC|ETH|SOL|BNB|XRP|DOGE)USDT$/.test(symbol)) { socket.emit('status', { symbol, status: 'offline', error: 'unsupported symbol' }); return }
    if (current && current !== symbol) releaseSymbol(current)
    current = symbol
    const s = state(symbol)
    socket.emit('snapshot', snapshot(s))
    socket.emit('status', { symbol, status: s.status, error: s.lastError ?? null })
    await ensureSymbol(symbol)
    socket.emit('snapshot', snapshot(s))
    socket.emit('status', { symbol, status: s.status, error: s.lastError ?? null })
  })
  socket.on('disconnect', () => { if (current) releaseSymbol(current) })
})

// relay high-frequency spot events (only for the active symbol)
setInterval(() => {
  for (const s of S.values()) {
    if (s.streams <= 0) continue
    if (s.ticker) io.emit('ticker', { symbol: s.symbol, ticker: s.ticker })
    if (s.mark) io.emit('mark', { symbol: s.symbol, mark: s.mark })
    if (s.depth) io.emit('depth', { symbol: s.symbol, depth: s.depth })
    // relay fresh aggTrades in one batch
    if (s.trades.length) {
      let i = s.trades.length - 1
      while (i >= 0 && s.trades[i].a > s.lastSentTradeId) i--
      const fresh = s.trades.slice(i + 1)
      if (fresh.length) {
        io.emit('trade', { symbol: s.symbol, trades: fresh })
        s.lastSentTradeId = fresh[fresh.length - 1].a
      }
    }
  }
}, 250)

setInterval(() => {
  for (const s of S.values()) {
    if (s.streams <= 0) continue
    if (s.klines.length) io.emit('kline', { symbol: s.symbol, kline: s.klines[s.klines.length - 1] })
  }
}, 500)

httpServer.listen(PORT, () => console.log(`[terminal-stream] listening on :${PORT}`))
