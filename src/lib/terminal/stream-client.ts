'use client'

import { io, type Socket } from 'socket.io-client'
import type { Candle, HeatCol, Liq, Snapshot, Trade, WallRec, PullEv, SweepEv, IceEv } from './types'

/**
 * Singleton client for the terminal-stream socket.io service (port 3031 via
 * the gateway). Holds the latest market state in memory; panels pull at their
 * own cadence with useStream() so high-frequency data never triggers
 * global re-renders.
 */

export type StreamStatus = 'connecting' | 'live' | 'offline'

interface StreamState {
  symbol: string
  serverOffset: number       // serverTime - clientTime
  status: StreamStatus
  lastError: string | null
  trades: Trade[]            // newest last
  klines: Candle[]           // 1m, newest last
  ticker: Snapshot['ticker']
  depth: Snapshot['depth']
  ladder: Snapshot['ladder']
  heatCols: HeatCol[]        // oldest first
  mark: Snapshot['mark']
  oi: Snapshot['oi']
  oiHistory: { oi: number; t: number; usd: number }[] // accumulated from live OI events
  hasSnapshot: boolean
  liqs: Liq[]                // newest last
  bookTop: { b: number; a: number } | null
  walls: WallRec[]
  pulls: PullEv[]            // newest last
  sweeps: SweepEv[]
  icebergs: IceEv[]
  lastMsgAt: number
  lastTradeReceivedAt: number // live trade-event receipt, independent of exchange/server clock skew
  lastTradeA: number         // highest aggTrade id applied (dedupe guard)
}

const state: StreamState = {
  symbol: 'BTCUSDT',
  serverOffset: 0,
  status: 'connecting',
  lastError: null,
  trades: [],
  klines: [],
  ticker: null,
  depth: null,
  ladder: null,
  heatCols: [],
  mark: null,
  oi: null,
  oiHistory: [],
  hasSnapshot: false,
  liqs: [],
  bookTop: null,
  walls: [],
  pulls: [],
  sweeps: [],
  icebergs: [],
  lastMsgAt: 0,
  lastTradeReceivedAt: 0,
  lastTradeA: 0,
}

let socket: Socket | null = null
let wanted = 'BTCUSDT'
const listeners = new Set<() => void>()

// ---------------------------------------------------------------- CVD series
/**
 * Append-only cumulative volume delta (USD), maintained independently of
 * state.trades. state.trades is REPLACED by every snapshot and capped, so
 * any CVD recomputed from it flips sign/magnitude whenever a background
 * snapshot lands and its 5m/30m/session windows collapse into each other.
 * This series only ever grows: trades are deduped by aggTrade id for the
 * whole session, live trades append at the tail, and when a snapshot brings
 * older unseen trades they are merged in timestamp order and the cumulative
 * is rebuilt ONCE from the merged set.
 */
interface CvdPoint { t: number; cum: number }
const cvdSeen = new Set<number>()
let cvdTrades: Trade[] = []        // deduped, sorted by (t, a)
let cvdPoints: CvdPoint[] = []     // parallel to cvdTrades: cum AFTER each trade
let cvdBaseCum = 0                 // cum of trades dropped by the memory guard
let cvdBaseT = 0                   // time up to which cvdBaseCum applies
let cvdCount = 0                   // total trades ever applied (incl. dropped)

const cvdDelta = (t: Trade) => (t.m ? -t.p * t.q : t.p * t.q)

function cvdRebuild() {
  cvdTrades.sort((a, b) => a.t - b.t || a.a - b.a)
  let cum = cvdBaseCum
  cvdPoints = cvdTrades.map((t) => { cum += cvdDelta(t); return { t: t.t, cum } })
}

function cvdAdd(incoming: readonly Trade[]) {
  const fresh: Trade[] = []
  for (const t of incoming) {
    if (!t || !isFinite(t.p * t.q)) continue
    if (cvdSeen.has(t.a)) continue
    cvdSeen.add(t.a)
    fresh.push(t)
  }
  if (!fresh.length) return
  cvdCount += fresh.length
  fresh.sort((a, b) => a.t - b.t || a.a - b.a)
  const last = cvdTrades[cvdTrades.length - 1]
  if (!last || fresh[0].t > last.t || (fresh[0].t === last.t && fresh[0].a > last.a)) {
    // fast path: everything is newer than the tail — append
    let cum = cvdPoints.length ? cvdPoints[cvdPoints.length - 1].cum : cvdBaseCum
    for (const t of fresh) {
      cvdTrades.push(t)
      cum += cvdDelta(t)
      cvdPoints.push({ t: t.t, cum })
    }
  } else {
    // snapshot brought older trades: merge + rebuild the cumulative once
    cvdTrades.push(...fresh)
    cvdRebuild()
  }
  // memory guard: drop the oldest chunk, folding its cum into the base
  if (cvdTrades.length > 400_000) {
    const drop = cvdTrades.length - 300_000
    const dropped = cvdTrades.splice(0, drop)
    cvdBaseCum = cvdPoints[drop - 1]?.cum ?? cvdBaseCum
    cvdBaseT = dropped[dropped.length - 1]?.t ?? cvdBaseT
    cvdPoints.splice(0, drop)
    for (const t of dropped) cvdSeen.delete(t.a)
  }
}

function cvdReset() {
  cvdSeen.clear()
  cvdTrades = []
  cvdPoints = []
  cvdBaseCum = 0
  cvdBaseT = 0
  cvdCount = 0
}

/** Cumulative USD delta at time ts (last point with t <= ts). */
export function getCvdCumAt(ts: number): number {
  if (!cvdPoints.length) return cvdBaseCum
  let lo = 0, hi = cvdPoints.length - 1, found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (cvdPoints[mid].t <= ts) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found >= 0 ? cvdPoints[found].cum : cvdBaseCum
}

export function getCvdLatest(): CvdPoint | null {
  if (cvdPoints.length) return cvdPoints[cvdPoints.length - 1]
  return cvdCount ? { t: cvdBaseT, cum: cvdBaseCum } : null
}

export function getCvdPoints(): readonly CvdPoint[] { return cvdPoints }
export function getCvdCount(): number { return cvdCount }
export function getCvdFirstT(): number | null {
  if (cvdPoints.length) return cvdPoints[0].t
  return cvdCount ? cvdBaseT : null
}

/** Keep the displayed 24h range honest: live prices widen it immediately. */
function widenRange(price: number) {
  if (!state.ticker || !isFinite(price) || price <= 0) return
  if (price > state.ticker.h) state.ticker = { ...state.ticker, h: price }
  if (price < state.ticker.l) state.ticker = { ...state.ticker, l: price }
}

function applySnapshot(snap: Snapshot) {
  if (snap.symbol !== wanted) return
  state.serverOffset = snap.serverTime - Date.now()
  state.status = snap.status
  state.lastError = snap.lastError
  // dedupe by aggTrade id (server REST/WS seam can overlap) and order by id
  const byId = new Map<number, Trade>()
  for (const t of snap.trades ?? []) if (!byId.has(t.a)) byId.set(t.a, t)
  state.trades = [...byId.values()].sort((a, b) => a.a - b.a)
  // the snapshot's trades also feed the append-only CVD series (deduped by
  // id there — a snapshot replacing state.trades must never reset CVD)
  cvdAdd(state.trades)
  state.klines = snap.klines ?? []
  state.ticker = snap.ticker
  state.depth = snap.depth
  state.ladder = snap.ladder
  state.heatCols = snap.heatCols ?? []
  state.mark = snap.mark
  state.oi = snap.oi
  if (snap.oi) pushOiHistory(snap.oi)
  state.hasSnapshot = true
  state.liqs = snap.liqs ?? []
  // bookTop comes ONLY from the bookTicker-fed snapshot field — never from
  // depth — so the header and the order-book rail share one source.
  state.bookTop = snap.bookTop && snap.bookTop.b > 0 && snap.bookTop.a > 0 ? snap.bookTop : state.bookTop
  state.walls = snap.walls ?? []
  state.pulls = snap.pulls ?? []
  state.sweeps = snap.sweeps ?? []
  state.icebergs = snap.icebergs ?? []
  state.lastMsgAt = Date.now()
  const lastSnapTrade = state.trades[state.trades.length - 1]
  if (lastSnapTrade) {
    state.lastTradeA = Math.max(state.lastTradeA, lastSnapTrade.a)
    widenRange(lastSnapTrade.p)
  }
  listeners.forEach((l) => l())
}

function pushOiHistory(oi: { oi: number; t: number }) {
  const px = state.mark?.p ?? state.ticker?.c ?? 0
  const last = state.oiHistory[state.oiHistory.length - 1]
  if (last && oi.t - last.t < 4000) { last.oi = oi.oi; last.usd = px > 0 ? oi.oi * px : last.usd; return }
  state.oiHistory.push({ oi: oi.oi, t: oi.t, usd: px > 0 ? oi.oi * px : 0 })
  if (state.oiHistory.length > 720) state.oiHistory.splice(0, state.oiHistory.length - 720)
}

function ensureSocket(): Socket {
  if (socket) return socket
  const streamUrl = process.env.NEXT_PUBLIC_STREAM_URL || (typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
    ? `${window.location.protocol}//${window.location.hostname}:3031`
    : '/?XTransformPort=3031')
  socket = io(streamUrl, {
    path: '/',
    transports: ['websocket', 'polling'],
    // The stream can be slow to accept under VPS load; the 20s default
    // connect timeout fired "Stream connection error: timeout" on cold
    // loads that would have connected seconds later.
    timeout: 45_000,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
  })
  if (typeof window !== 'undefined') {
    ;(window as unknown as { __stream: unknown }).__stream = {
      getSocket: () => socket,
      state,
    }
  }
  socket.io.on('error', (err) => console.warn('[stream] manager error', err))
  socket.on('disconnect', () => {
    state.status = 'offline'
    state.lastError = 'Market data connection lost; reconnecting'
    listeners.forEach(l => l())
  })
  socket.on('connect_error', (err) => {
    console.warn('[stream] connect_error:', err.message)
    state.lastError = `stream connection error: ${err.message} — retrying`
    listeners.forEach((l) => l())
  })
  socket.on('connect', () => console.info('[stream] connected via', socket!.io.engine.transport.name))
  socket.on('connect', () => {
    socket!.emit('subscribe', { symbol: wanted })
    // If no snapshot lands shortly after (re)connect — e.g. the first
    // subscribe raced a slow warm-up — ask again with refresh so the server
    // re-sends its (cached) snapshot instead of sitting on CONNECTING.
    let tries = 0
    const watchdog = setInterval(() => {
      if (!socket?.connected || state.hasSnapshot || ++tries > 6) { clearInterval(watchdog); return }
      socket.emit('subscribe', { symbol: wanted, refresh: true })
    }, 4000)
  })
  socket.on('snapshot', applySnapshot)
  socket.on('status', (e: { symbol: string; status: StreamStatus; error: string | null }) => {
    if (e.symbol !== wanted) return
    state.status = e.status
    state.lastError = e.error
    listeners.forEach((l) => l())
  })
  socket.on('trade', (e: { symbol: string; trades: Trade[] }) => {
    if (e.symbol !== wanted || !e.trades?.length) return
    // drop trades already applied via snapshot (id guard — relay can overlap)
    const fresh = e.trades.filter((t) => t.a > state.lastTradeA)
    if (!fresh.length) return
    state.lastTradeA = fresh[fresh.length - 1].a
    cvdAdd(fresh)
    state.trades.push(...fresh)
    widenRange(fresh[fresh.length - 1].p)
    state.lastTradeReceivedAt = Date.now()
    if (state.trades.length > 6000) state.trades.splice(0, state.trades.length - 6000)
    state.lastMsgAt = Date.now()
    listeners.forEach((l) => l())
  })
  socket.on('depth', (e: { symbol: string; depth: Snapshot['depth'] }) => {
    if (e.symbol !== wanted) return
    state.depth = e.depth
    state.lastMsgAt = Date.now()
    listeners.forEach((l) => l())
  })
  socket.on('kline', (e: { symbol: string; kline: Candle }) => {
    if (e.symbol !== wanted) return
    const k = e.kline
    const last = state.klines[state.klines.length - 1]
    if (last && last.t === k.t) state.klines[state.klines.length - 1] = k
    else if (!last || k.t > last.t) { state.klines.push(k); if (state.klines.length > 1100) state.klines.shift() }
    widenRange(k.c)
    state.lastMsgAt = Date.now()
    listeners.forEach((l) => l())
  })
  socket.on('ticker', (e: { symbol: string; ticker: Snapshot['ticker'] }) => {
    if (e.symbol !== wanted) return
    state.ticker = e.ticker
    // the rolling 24h window can lag a fast move — never let it contradict
    // prices already seen live in this session
    const px = state.trades[state.trades.length - 1]?.p ?? state.klines[state.klines.length - 1]?.c
    if (px) widenRange(px)
    listeners.forEach((l) => l())
  })
  socket.on('mark', (e: { symbol: string; mark: Snapshot['mark'] }) => {
    if (e.symbol !== wanted) return
    state.mark = e.mark
    state.lastMsgAt = Date.now()
    listeners.forEach((l) => l())
  })
  socket.on('oi', (e: { symbol: string; oi: Snapshot['oi'] }) => {
    if (e.symbol !== wanted) return
    state.oi = e.oi
    if (e.oi) pushOiHistory(e.oi)
    listeners.forEach((l) => l())
  })
  socket.on('liq', (e: { symbol: string; liq: Liq }) => {
    if (e.symbol !== wanted) return
    state.liqs.push(e.liq)
    if (state.liqs.length > 300) state.liqs.shift()
    listeners.forEach((l) => l())
  })
  socket.on('ladder-col', (e: { symbol: string; col: HeatCol }) => {
    if (e.symbol !== wanted) return
    state.heatCols.push(e.col)
    if (state.heatCols.length > 2400) state.heatCols.splice(0, state.heatCols.length - 2400)
    state.ladder = { bids: e.col.bids, asks: e.col.asks, t: e.col.t }
    state.lastMsgAt = Date.now()
    listeners.forEach((l) => l())
  })
  socket.on('bookTop', (e: { symbol: string; b: number; a: number }) => {
    if (e.symbol !== wanted) return
    state.bookTop = { b: e.b, a: e.a }
    state.lastMsgAt = Date.now()
    listeners.forEach((l) => l())
  })
  socket.on('walls', (e: { symbol: string; walls: WallRec[] }) => {
    if (e.symbol !== wanted) return
    state.walls = e.walls
    listeners.forEach((l) => l())
  })
  socket.on('pull', (e: { symbol: string; ev: PullEv }) => {
    if (e.symbol !== wanted) return
    state.pulls.push(e.ev)
    if (state.pulls.length > 400) state.pulls.shift()
    listeners.forEach((l) => l())
  })
  socket.on('sweep', (e: { symbol: string; ev: SweepEv }) => {
    if (e.symbol !== wanted) return
    state.sweeps.push(e.ev)
    if (state.sweeps.length > 300) state.sweeps.shift()
    listeners.forEach((l) => l())
  })
  socket.on('iceberg', (e: { symbol: string; ev: IceEv }) => {
    if (e.symbol !== wanted) return
    state.icebergs.push(e.ev)
    if (state.icebergs.length > 200) state.icebergs.shift()
    listeners.forEach((l) => l())
  })
  return socket
}

export function setStreamSymbol(symbol: string) {
  ensureSocket()
  if (symbol === wanted) return
  wanted = symbol
  // reset buffers so stale data for the previous symbol is never shown
  state.symbol = symbol
  state.trades = []; state.klines = []; state.heatCols = []; state.liqs = []
  state.oiHistory = []; state.hasSnapshot = false
  state.ticker = null; state.depth = null; state.ladder = null; state.mark = null; state.oi = null
  state.bookTop = null; state.walls = []; state.pulls = []; state.sweeps = []; state.icebergs = []
  state.status = 'connecting'
  state.lastTradeA = 0
  state.lastTradeReceivedAt = 0
  cvdReset()
  if (socket?.connected) socket.emit('subscribe', { symbol })
  listeners.forEach((l) => l())
}

export function getStream(): Readonly<StreamState> {
  return state
}

export function now(): number {
  return Date.now() + state.serverOffset
}

/** Pull-based hook helper: re-render a component at a fixed cadence. */
export function subscribeStream(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
