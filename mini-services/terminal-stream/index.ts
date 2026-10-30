/**
 * terminal-stream — real-time market data bridge (port 3031)
 *
 * Subscribes to Binance public spot + futures WebSocket streams, maintains a
 * LOCAL full order book per symbol (snapshot + diff-depth @100ms) and pushes
 * granular updates to the browser via socket.io. All data is public market
 * data, no API keys.
 *
 * Events emitted to clients:
 *  snapshot     full state on subscribe
 *  bookTop      best bid/ask + spread (10Hz, tiny)
 *  depth        top-20 book computed from the local book (10Hz)
 *  ladder-col   heat column from the LOCAL book (4Hz — smooth heatmap)
 *  trade        batched aggTrades (10Hz relay)
 *  kline        1m kline update (2Hz)
 *  ticker       24h rolling window stats (1s)
 *  walls        current liquidity walls: {side, p, q, firstSeen, pulls} (1s)
 *  pull         large level cancelled before being traded (spoof-style)
 *  sweep        large level consumed at best price by aggressive flow
 *  iceberg      level repeatedly refilled after consumption
 *  mark         futures mark price / funding (poll 5s)
 *  oi           open interest (poll 10s)
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
interface WallRec { side: 'bid' | 'ask'; p: number; q: number; firstSeen: number; pulls: number; maxQ: number }
interface PullEv { t: number; side: 'bid' | 'ask'; p: number; size: number; lasted: number; count: number }
interface SweepEv { t: number; side: 'bid' | 'ask'; p: number; size: number; trade: number }
interface IceEv { t: number; side: 'bid' | 'ask'; p: number; size: number; refills: number }

interface LevelTrack {
  q: number
  maxQ: number
  firstSeen: number
  lastSeen: number
  pulls: number
  refills: number
  lastIcebergEmit: number
}

interface SymbolState {
  symbol: string
  streams: number
  valid?: boolean
  spotWs?: WebSocket
  futWs?: WebSocket
  status: 'connecting' | 'live' | 'offline'
  lastError?: string
  // local order book
  bids: Map<string, number>
  asks: Map<string, number>
  lastUpdateId: number
  bookReady: boolean
  seededPartial: boolean      // book built from WS top-20 (REST unavailable)
  lastPartial?: { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] }
  lastPartialAt: number
  lastSyncAttempt: number
  syncBackoff: number
  diffBuffer: any[]
  syncing: boolean
  bookTop: { b: number; a: number }
  // derived
  trades: Trade[]
  klines: Candle[]
  ticker?: Record<string, number | string>
  lastDepthPayload: string
  heatCols: HeatCol[]
  mark?: { p: number; funding: number; nextFunding: number; index: number }
  oi?: { oi: number; t: number }
  liqs: Liq[]
  // event detection
  lv: Map<string, LevelTrack>
  lastTradeAtP: Map<number, number>
  walls: WallRec[]
  pulls: PullEv[]
  sweeps: SweepEv[]
  icebergs: IceEv[]
  medianNotional: number
  // timers
  timers: ReturnType<typeof setInterval>[]
  lastSentTradeId: number
  lastKlineSent: number
}

const S = new Map<string, SymbolState>()
const state = (symbol: string): SymbolState => {
  let s = S.get(symbol)
  if (!s) {
    s = {
      symbol, streams: 0, status: 'connecting',
      bids: new Map(), asks: new Map(), lastUpdateId: 0, bookReady: false, seededPartial: false,
      lastPartialAt: 0, lastSyncAttempt: 0, syncBackoff: 5000, diffBuffer: [], syncing: false,
      bookTop: { b: 0, a: 0 },
      trades: [], klines: [], lastDepthPayload: '', heatCols: [], liqs: [],
      lv: new Map(), lastTradeAtP: new Map(), walls: [], pulls: [], sweeps: [], icebergs: [],
      medianNotional: 0, timers: [], lastSentTradeId: 0, lastKlineSent: 0,
    }
    S.set(symbol, s)
  }
  return s
}

const lc = (x: string) => x.toLowerCase()
const RING = <T,>(arr: T[], max: number) => { if (arr.length > max) arr.splice(0, arr.length - max) }
const now = () => Date.now()

async function jget(url: string, timeoutMs = 8000): Promise<any> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (res.status === 418 || res.status === 429) {
      // Binance weight ban — record it so every REST call to this host pauses
      let until = Date.now() + 120_000
      try {
        const body = await res.json()
        const m = /until (\d+)/.exec(body?.msg ?? '')
        if (m) until = +m[1] + 5_000
      } catch { /* default 2 min */ }
      restBanUntil.set(new URL(url).host, until)
      throw new RestBanError(until)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(timer) }
}

class RestBanError extends Error {
  banUntil: number
  constructor(until: number) { super(`REST banned until ${until}`); this.banUntil = until }
}
const restBanUntil = new Map<string, number>()
function restBlocked(host: string): number {
  const u = restBanUntil.get(host) ?? 0
  return Date.now() < u ? u : 0
}

// ---------------------------------------------------------------- thresholds
// Adaptive notional thresholds so every symbol (BTC to DOGE) gets sensible
// pull/wall/sweep detection scaled to its local liquidity.
function thresholds(s: SymbolState) {
  const m = s.medianNotional
  return {
    pullMin: Math.max(12_000, 3 * m),
    wallMin: Math.max(40_000, 8 * m),
    sweepMin: Math.max(25_000, 5 * m),
  }
}

function medianNotional(s: SymbolState) {
  const bestBid = best(s.bids), bestAsk = best(s.asks, true)
  if (!bestBid || !bestAsk) return
  const mid = (bestBid + bestAsk) / 2
  const lo = mid * 0.995, hi = mid * 1.005
  const arr: number[] = []
  const scan = (m: Map<string, number>, inside: boolean) => {
    let n = 0
    for (const [ps, q] of m) {
      const p = +ps
      if (inside && (p < lo || p > hi)) continue
      arr.push(q * p)
      if (++n > 400) break
    }
  }
  scan(s.bids, true); scan(s.asks, true)
  if (arr.length < 20) return
  arr.sort((a, b) => a - b)
  s.medianNotional = arr[Math.floor(arr.length / 2)] || 0
}

function best(m: Map<string, number>, asc = false): number | null {
  let b: number | null = null
  for (const ps of m.keys()) {
    const p = +ps
    if (b === null) b = p
    else if (asc ? p < b : p > b) b = p
  }
  return b
}

// ---------------------------------------------------------------- local book
function applyDiff(s: SymbolState, U: number, u: number, b: string[][], a: string[][]) {
  for (const [ps, qs] of b) setLevel(s, 'bid', +ps, +qs)
  for (const [ps, qs] of a) setLevel(s, 'ask', +ps, +qs)
  s.lastUpdateId = u
  void U
}

function setLevel(s: SymbolState, side: 'bid' | 'ask', p: number, q: number) {
  if (!isFinite(p) || p <= 0) return
  const map = side === 'bid' ? s.bids : s.asks
  const key = `${side}:${p}`
  const prevQ = map.get(String(p)) ?? 0
  const prevNot = prevQ * p
  const nextNot = q * p
  const t = now()
  if (q === 0) map.delete(String(p))
  else map.set(String(p), q)

  // ---- level lifecycle tracking (pulls / icebergs)
  let tr = s.lv.get(key)
  if (!tr) {
    if (q === 0) { s.lv.delete(key); return }
    tr = { q, maxQ: q, firstSeen: t, lastSeen: t, pulls: 0, refills: 0, lastIcebergEmit: 0 }
    s.lv.set(key, tr)
  }
  const { pullMin } = thresholds(s)
  if (prevNot >= pullMin && nextNot < prevNot * 0.15) {
    // big drop — was it traded away or pulled?
    const lastTradeT = s.lastTradeAtP.get(p) ?? 0
    const traded = lastTradeT > tr.lastSeen - 250 && lastTradeT <= t + 250
    if (!traded && q === 0) {
      tr.pulls++
      s.pulls.push({ t, side, p, size: prevNot, lasted: t - tr.firstSeen, count: tr.pulls })
      RING(s.pulls, 400)
    } else if (traded) {
      tr.refills++
      if (tr.refills >= 3 && t - tr.lastIcebergEmit > 60_000) {
        tr.lastIcebergEmit = t
        s.icebergs.push({ t, side, p, size: tr.maxQ * p, refills: tr.refills })
        RING(s.icebergs, 200)
      }
    }
  } else if (prevNot > 0 && nextNot > prevNot * 1.6) {
    // heavy refill
    tr.refills++
    if (tr.refills >= 3 && prevNot >= pullMin * 0.6 && t - tr.lastIcebergEmit > 60_000) {
      tr.lastIcebergEmit = t
      s.icebergs.push({ t, side, p, size: tr.maxQ * p, refills: tr.refills })
      RING(s.icebergs, 200)
    }
  }
  tr.q = q
  tr.lastSeen = t
  if (q * p > tr.maxQ) tr.maxQ = q
}

async function syncBook(s: SymbolState) {
  if (s.syncing) return
  // REST banned? build a usable top-20 book from the WS partial-depth stream
  const blocked = restBlocked('api.binance.com')
  if (blocked) {
    s.lastError = `Binance REST banned until ${new Date(blocked).toISOString().slice(11, 19)}Z — WS partial book in use`
    seedFromPartial(s)
    return
  }
  if (Date.now() - s.lastSyncAttempt < s.syncBackoff) return
  s.lastSyncAttempt = Date.now()
  s.syncing = true
  try {
    const snap = await jget(`https://api.binance.com/api/v3/depth?symbol=${s.symbol}&limit=1000`, 12000)
    s.bids.clear(); s.asks.clear()
    for (const [ps, qs] of snap.bids) { const q = +qs; if (q > 0) s.bids.set(String(+ps), q) }
    for (const [ps, qs] of snap.asks) { const q = +qs; if (q > 0) s.asks.set(String(+ps), q) }
    s.lastUpdateId = snap.lastUpdateId
    s.bookReady = true
    s.seededPartial = false
    s.syncBackoff = 5000
    s.lastError = undefined
    console.log(`[book] synced ${s.symbol}: lastUpdateId=${snap.lastUpdateId} bids=${s.bids.size} asks=${s.asks.size} buffered=${s.diffBuffer.length}`)
    // apply buffered diffs in order
    const buf = s.diffBuffer
    s.diffBuffer = []
    for (const d of buf) {
      if (d.u <= s.lastUpdateId) continue
      if (d.U > s.lastUpdateId + 1) { s.syncing = false; return syncBook(s) } // gap — resync
      applyDiff(s, d.U, d.u, d.b, d.a)
    }
  } catch (e) {
    if (e instanceof RestBanError) {
      console.warn(`[book] REST banned for ${s.symbol} — falling back to WS partial book`)
      seedFromPartial(s)
    } else {
      s.lastError = 'book snapshot failed'
      s.syncBackoff = Math.min(60_000, s.syncBackoff * 2)
      console.error(`[book] snapshot failed for ${s.symbol}:`, e instanceof Error ? e.message : e)
    }
  } finally {
    s.syncing = false
  }
}

/** Seed a usable top-20 book from the last WS partial-depth payload. */
function seedFromPartial(s: SymbolState) {
  const d = s.lastPartial
  if (!d) return
  s.bids.clear(); s.asks.clear()
  for (const [ps, qs] of d.bids) { const q = +qs; if (q > 0) s.bids.set(String(+ps), q) }
  for (const [ps, qs] of d.asks) { const q = +qs; if (q > 0) s.asks.set(String(+ps), q) }
  if (!s.bids.size || !s.asks.size) return
  const wasReady = s.bookReady
  s.lastUpdateId = d.lastUpdateId
  s.bookReady = true
  s.seededPartial = true
  s.lastError = undefined
  s.status = 'live'
  medianNotional(s)
  if (!wasReady) {
    console.log(`[book] seeded ${s.symbol} from WS partial book: bids=${s.bids.size} asks=${s.asks.size}`)
    broadcastStatus(s)
  }
}

function handleBookDiff(s: SymbolState, d: any) {
  if (!s.bookReady) {
    s.diffBuffer.push(d)
    if (s.diffBuffer.length > 800) s.diffBuffer.shift()
    // snapshot may never have landed (startup race) — retry from the buffer side
    if (!s.syncing && s.diffBuffer.length >= 2) void syncBook(s)
    return
  }
  if (d.u <= s.lastUpdateId) return // stale
  if (d.U > s.lastUpdateId + 1) { s.bookReady = false; void syncBook(s); return } // gap — resync
  applyDiff(s, d.U, d.u, d.b, d.a)
}

// ---------------------------------------------------------------- upstream WS
function openSpotWs(s: SymbolState) {
  const sym = lc(s.symbol)
  // depth20@100ms = free top-20 snapshot stream — seeds the book when REST is banned
  const streams = [`${sym}@aggTrade`, `${sym}@depth@100ms`, `${sym}@depth20@100ms`, `${sym}@kline_1m`, `${sym}@ticker`, `${sym}@bookTicker`].join('/')
  let retry = 0
  const connect = () => {
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
    s.spotWs = ws
    ws.onopen = () => { retry = 0; s.status = 'live'; s.lastError = undefined; broadcastStatus(s) }
    ws.onmessage = (ev) => { try { handleSpot(s, JSON.parse(ev.data as string)) } catch { /* ignore */ } }
    ws.onclose = () => {
      if (s.spotWs !== ws) return
      s.status = 'offline'
      broadcastStatus(s)
      retry++; setTimeout(connect, Math.min(15000, 800 * retry))
    }
    ws.onerror = () => { s.lastError = 'spot stream error' }
  }
  connect()
}

function openFutWs(s: SymbolState) {
  const sym = lc(s.symbol)
  let retry = 0
  const connect = () => {
    const ws = new WebSocket(`wss://fstream.binance.com/stream?streams=${sym}@markPrice@1s/${sym}@forceOrder`)
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
    const p = +d.p, q = +d.q, t = d.T
    s.trades.push({ a: d.a, p, q, t, m: d.m })
    RING(s.trades, 8000)
    // trade-time index for pull/consumption decisions + sweep detection
    const bestBid = best(s.bids), bestAsk = best(s.asks, true)
    if (bestBid && bestAsk && p > bestBid * 0.98 && p < bestAsk * 1.02) {
      s.lastTradeAtP.set(p, t)
      if (s.lastTradeAtP.size > 3000) {
        // prune far prices
        const mid = (bestBid + bestAsk) / 2
        for (const kp of s.lastTradeAtP.keys()) if (kp < mid * 0.97 || kp > mid * 1.03) s.lastTradeAtP.delete(kp)
      }
      const { sweepMin } = thresholds(s)
      const not = p * q
      if (not >= sweepMin) {
        // sweep = aggressive print consumed a big resting level at/near best
        const side: 'bid' | 'ask' = d.m ? 'bid' : 'ask' // seller-maker => buy swept the ask
        const lvlKey = `${side}:${p}`
        const tr = s.lv.get(lvlKey)
        if (tr && tr.maxQ * p >= sweepMin * 0.6 && (tr.lastSeen > t - 1500 || tr.q * p >= sweepMin * 0.5)) {
          s.sweeps.push({ t, side, p, size: Math.max(tr.maxQ * p, not), trade: not })
          RING(s.sweeps, 300)
        }
      }
    }
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
    s.ticker = { c: +d.c, P: +d.P, h: +d.h, l: +d.l, v: +d.v, q: +d.q, b: +d.b, a: +d.a, O: d.O, C: d.C }
    return
  }
  if (d.e === undefined && d.lastUpdateId !== undefined && d.bids && d.asks) {
    // partial book depth (top-20) — keeps a seed available when REST is banned
    s.lastPartial = d
    if (!s.bookReady || (s.seededPartial && Date.now() - (s.lastPartialAt ?? 0) > 2000)) {
      s.lastPartialAt = Date.now()
      seedFromPartial(s)
    }
    return
  }
  if (d.e === 'bookTicker' || (d.e === undefined && d.s && typeof d.b === 'string' && typeof d.a === 'string')) {
    // instant best bid/ask — feeds bookTop relay (raw payload has no event type)
    s.bookTop = { b: +d.b, a: +d.a }
    return
  }
  if (d.U !== undefined && d.b && d.a && d.e === undefined) { handleBookDiff(s, d); return }
  if (d.e === 'depthUpdate') { handleBookDiff(s, d); return }
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
  s.trades = (Array.isArray(tr) ? tr : []).map((x: any) => ({ a: +x.a, p: +x.p, q: +x.q, t: +x.T, m: !!x.m }))
  s.trades.sort((a, b) => a.t - b.t)
  s.lastSentTradeId = s.trades.length ? s.trades[s.trades.length - 1].a : 0
}

async function pollMark(s: SymbolState) {
  try {
    const d = await jget(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s.symbol}`)
    s.mark = { p: +d.markPrice, funding: +d.lastFundingRate, nextFunding: +d.nextFundingTime, index: +d.indexPrice }
    io.emit('mark', { symbol: s.symbol, mark: s.mark })
  } catch { /* transient */ }
}

async function validateSymbol(symbol: string): Promise<boolean | 'unknown'> {
  try {
    await jget(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`, 8000)
    return true
  } catch (e) {
    // REST banned / rate-limited: can't verify — assume valid and let the WS
    // prove the symbol (Binance closes the stream for unknown symbols)
    if (e instanceof RestBanError) return 'unknown'
    return false
  }
}

async function ensureSymbol(symbol: string) {
  const s = state(symbol)
  s.streams++
  if (s.timers.length) { // already warm — book, WS and history are alive
    const wi = warmOrder.indexOf(symbol)
    if (wi >= 0) warmOrder.splice(wi, 1)
    return
  }
  if (s.valid === undefined) {
    const v = await validateSymbol(symbol)
    s.valid = v === 'unknown' ? true : v
  }
  if (!s.valid) {
    s.status = 'offline'
    s.lastError = 'unsupported symbol'
    broadcastStatus(s)
    return
  }
  s.status = 'connecting'
  openSpotWs(s)
  openFutWs(s)
  try { await loadHistory(s) } catch { s.lastError = 'history load failed' }
  void syncBook(s).then(() => { medianNotional(s) })
  pollOi(s); pollMark(s)
  s.timers.push(setInterval(() => { // 250ms — heat column from local book
    emitHeatCol(s)
  }, 250))
  s.timers.push(setInterval(() => { // 1s — walls snapshot + median refresh
    if (s.streams > 0 && s.bookReady) { medianNotional(s); emitWalls(s) }
  }, 1000))
  s.timers.push(setInterval(() => pollOi(s), 10_000))
  s.timers.push(setInterval(() => pollMark(s), 5_000))
  s.timers.push(setInterval(() => { // book watchdog — REST backoff aware, auto-upgrades partial book
    if (s.bookReady && s.seededPartial && !restBlocked('api.binance.com') && !s.syncing) {
      console.log(`[book] REST reachable again — upgrading ${s.symbol} to full depth`)
      s.bookReady = false
      s.seededPartial = false
      void syncBook(s)
      return
    }
    if (!s.bookReady && !s.syncing) void syncBook(s)
  }, 5_000))
}

function collectLevels(map: Map<string, number>, asc: boolean, lo: number, hi: number, cap: number): Level[] {
  const out: Level[] = []
  for (const [ps, q] of map) {
    const p = +ps
    if (p < lo || p > hi || q <= 0) continue
    out.push({ p, q })
  }
  out.sort((a, b) => (asc ? a.p - b.p : b.p - a.p))
  return out.slice(0, cap)
}

function emitHeatCol(s: SymbolState) {
  if (s.streams <= 0 || !s.bookReady) return
  const bestBid = best(s.bids), bestAsk = best(s.asks, true)
  if (!bestBid || !bestAsk) return
  const mid = (bestBid + bestAsk) / 2
  const lo = mid * 0.9935, hi = mid * 1.0065 // ±0.65% window
  const col: HeatCol = {
    t: Date.now(), mid,
    bids: collectLevels(s.bids, false, lo, hi, 260),
    asks: collectLevels(s.asks, true, lo, hi, 260),
  }
  s.heatCols.push(col)
  RING(s.heatCols, 2900) // ~12 min @250ms — replayed (decimated) on every connect
  io.emit('ladder-col', { symbol: s.symbol, col })
}

function emitWalls(s: SymbolState) {
  const bestBid = best(s.bids), bestAsk = best(s.asks, true)
  if (!bestBid || !bestAsk) return
  const mid = (bestBid + bestAsk) / 2
  const lo = mid * 0.99, hi = mid * 1.01
  const { wallMin } = thresholds(s)
  const out: WallRec[] = []
  for (const side of ['bid', 'ask'] as const) {
    const map = side === 'bid' ? s.bids : s.asks
    for (const [ps, q] of map) {
      const p = +ps
      if (p < lo || p > hi) continue
      const not = q * p
      if (not < wallMin) continue
      const tr = s.lv.get(`${side}:${p}`)
      out.push({ side, p, q: not, firstSeen: tr?.firstSeen ?? Date.now(), pulls: tr?.pulls ?? 0, maxQ: tr?.maxQ ? tr.maxQ * p : not })
    }
  }
  out.sort((a, b) => b.q - a.q)
  s.walls = out.slice(0, 14)
  io.emit('walls', { symbol: s.symbol, walls: s.walls })
}

/**
 * Symbols stay WARM after the last subscriber disconnects: the local book and
 * heat-column history keep accumulating so the heatmap is already full when
 * the next page load connects. Bounded to WARM_MAX symbols (LRU eviction).
 */
const WARM_MAX = 3
const warmOrder: string[] = []

function evictWarm(keep: string) {
  while (warmOrder.length > WARM_MAX) {
    const evict = warmOrder.shift()!
    if (evict === keep) { warmOrder.push(evict); continue }
    const cur = S.get(evict)
    if (cur && cur.streams === 0) {
      cur.spotWs?.close(); cur.futWs?.close()
      cur.timers.forEach(clearInterval)
      S.delete(evict)
      console.log(`[terminal-stream] evicted cold symbol ${evict}`)
    }
  }
}

function releaseSymbol(symbol: string) {
  const s = S.get(symbol)
  if (!s) return
  s.streams = Math.max(0, s.streams - 1)
  if (s.streams === 0 && s.timers.length) {
    if (!warmOrder.includes(symbol)) warmOrder.push(symbol)
    evictWarm(symbol)
    console.log(`[terminal-stream] keeping ${symbol} warm (history keeps building)`)
  }
}

/**
 * History replay for snapshots: decimate the raw heat buffer so the client
 * gets depth coverage over the WHOLE recorded window (up to ~12 min) while
 * keeping the payload near the proven size (~800 columns).
 */
function snapshotHeatCols(s: SymbolState): HeatCol[] {
  const raw = s.heatCols
  if (raw.length <= 800) return raw.slice()
  const group = Math.ceil(raw.length / 800)
  const out: HeatCol[] = []
  for (let i = 0; i < raw.length; i += group) {
    const end = Math.min(raw.length, i + group)
    const bids = new Map<number, number>(), asks = new Map<number, number>()
    let mid = 0
    for (let j = i; j < end; j++) {
      const c = raw[j]
      mid = c.mid
      for (const l of c.bids) { const q0 = bids.get(l.p); if (q0 === undefined || l.q > q0) bids.set(l.p, l.q) }
      for (const l of c.asks) { const q0 = asks.get(l.p); if (q0 === undefined || l.q > q0) asks.set(l.p, l.q) }
    }
    const last = raw[end - 1]
    out.push({ t: last.t, mid, bids: [...bids].map(([p, q]) => ({ p, q })), asks: [...asks].map(([p, q]) => ({ p, q })) })
  }
  return out
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
    depth: topDepth(s),
    ladder: s.bookReady ? { bids: collectLevels(s.bids, false, 0, Infinity, 500), asks: collectLevels(s.asks, true, 0, Infinity, 500), t: Date.now() } : null,
    heatCols: snapshotHeatCols(s),
    mark: s.mark ?? null,
    oi: s.oi ?? null,
    liqs: s.liqs.slice(-150),
    walls: s.walls,
    pulls: s.pulls.slice(-120),
    sweeps: s.sweeps.slice(-120),
    icebergs: s.icebergs.slice(-80),
  }
}

function topDepth(s: SymbolState) {
  const bids = collectLevels(s.bids, false, 0, Infinity, 20)
  const asks = collectLevels(s.asks, true, 0, Infinity, 20)
  if (!bids.length || !asks.length) return null
  return { bids, asks }
}

function broadcastStatus(s: SymbolState) {
  io.emit('status', { symbol: s.symbol, status: s.status, error: s.lastError ?? null })
}

// ---------------------------------------------------------------- socket api
io.on('connection', (socket) => {
  let current: string | null = null
  socket.on('subscribe', async (msg: { symbol?: string }) => {
    const symbol = (msg?.symbol || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!/^[A-Z0-9]{5,20}$/.test(symbol) || !symbol.endsWith('USDT')) {
      socket.emit('status', { symbol, status: 'offline', error: 'unsupported symbol' })
      return
    }
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

// high-frequency relay (10Hz)
setInterval(() => {
  for (const s of S.values()) {
    if (s.streams <= 0) continue
    // trades
    if (s.trades.length) {
      let i = s.trades.length - 1
      while (i >= 0 && s.trades[i].a > s.lastSentTradeId) i--
      const fresh = s.trades.slice(i + 1)
      if (fresh.length) {
        io.emit('trade', { symbol: s.symbol, trades: fresh })
        s.lastSentTradeId = fresh[fresh.length - 1].a
      }
    }
    // book top + depth (only when payload changed)
    const bb = s.bookTop.b || best(s.bids)
    const ba = s.bookTop.a || best(s.asks, true)
    if (bb && ba) io.emit('bookTop', { symbol: s.symbol, b: bb, a: ba, t: Date.now() })
    const dep = topDepth(s)
    if (dep) {
      const payload = JSON.stringify(dep)
      if (payload !== s.lastDepthPayload) {
        s.lastDepthPayload = payload
        io.emit('depth', { symbol: s.symbol, depth: dep })
      }
    }
  }
}, 100)

// 2Hz kline relay
setInterval(() => {
  for (const s of S.values()) {
    if (s.streams <= 0 || !s.klines.length) continue
    const k = s.klines[s.klines.length - 1]
    if (k.t !== s.lastKlineSent) {
      s.lastKlineSent = k.t
      io.emit('kline', { symbol: s.symbol, kline: k })
    } else {
      io.emit('kline', { symbol: s.symbol, kline: k })
    }
  }
}, 500)

// 1s ticker relay
setInterval(() => {
  for (const s of S.values()) {
    if (s.streams <= 0) continue
    if (s.ticker) io.emit('ticker', { symbol: s.symbol, ticker: s.ticker })
  }
}, 1000)

httpServer.listen(PORT, () => console.log(`[terminal-stream] listening on :${PORT}`))
