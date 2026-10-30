'use client'

import { io, type Socket } from 'socket.io-client'
import type { Candle, HeatCol, Liq, Snapshot, Trade } from './types'

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
  liqs: Liq[]                // newest last
  lastMsgAt: number
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
  liqs: [],
  lastMsgAt: 0,
}

let socket: Socket | null = null
let wanted = 'BTCUSDT'
const listeners = new Set<() => void>()

function applySnapshot(snap: Snapshot) {
  if (snap.symbol !== wanted) return
  state.serverOffset = snap.serverTime - Date.now()
  state.status = snap.status
  state.lastError = snap.lastError
  state.trades = snap.trades ?? []
  state.klines = snap.klines ?? []
  state.ticker = snap.ticker
  state.depth = snap.depth
  state.ladder = snap.ladder
  state.heatCols = snap.heatCols ?? []
  state.mark = snap.mark
  state.oi = snap.oi
  state.liqs = snap.liqs ?? []
  state.lastMsgAt = Date.now()
  listeners.forEach((l) => l())
}

function ensureSocket(): Socket {
  if (socket) return socket
  socket = io('/?XTransformPort=3031', {
    path: '/',
    transports: ['websocket', 'polling'],
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
  socket.on('connect_error', (err) => console.warn('[stream] connect_error:', err.message))
  socket.on('connect', () => console.info('[stream] connected via', socket!.io.engine.transport.name))
  socket.on('connect', () => socket!.emit('subscribe', { symbol: wanted }))
  socket.on('snapshot', applySnapshot)
  socket.on('status', (e: { symbol: string; status: StreamStatus; error: string | null }) => {
    if (e.symbol !== wanted) return
    state.status = e.status
    state.lastError = e.error
    listeners.forEach((l) => l())
  })
  socket.on('trade', (e: { symbol: string; trades: Trade[] }) => {
    if (e.symbol !== wanted || !e.trades?.length) return
    state.trades.push(...e.trades)
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
    state.lastMsgAt = Date.now()
    listeners.forEach((l) => l())
  })
  socket.on('ticker', (e: { symbol: string; ticker: Snapshot['ticker'] }) => {
    if (e.symbol !== wanted) return
    state.ticker = e.ticker
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
    if (state.heatCols.length > 900) state.heatCols.shift()
    state.ladder = { bids: e.col.bids.slice(0, 50), asks: e.col.asks.slice(0, 50), t: e.col.t }
    state.lastMsgAt = Date.now()
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
  state.ticker = null; state.depth = null; state.ladder = null; state.mark = null; state.oi = null
  state.status = 'connecting'
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
