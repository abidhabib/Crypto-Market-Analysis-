'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getStream, now } from './stream-client'
import { mergeWhaleTrades } from './whales-model'
import { levels as decisionLevels } from './analytics'
import type { Candle, Trade } from './types'
import type { WhaleHistoryPage } from './whales-history'

function capture(symbol: string) {
  const s = getStream(), same = s.symbol === symbol
  return { symbol, observedAt: now(), status: same ? s.status : 'connecting' as const, lastMsgAt: same ? s.lastMsgAt : 0,
    trades: same ? s.trades.slice() : [] as Trade[], klines: same ? s.klines.map(c => ({ ...c })) : [] as Candle[],
    mid: same ? s.bookTop ? (s.bookTop.b + s.bookTop.a) / 2 : s.ticker?.c ?? null : null,
    plan: same ? decisionLevels() : null }
}
export type WhalesFeed = ReturnType<typeof capture>

/** A panel-local bounded recording. HTTP history never replaces newer live observations. */
export function useWhalesData(symbol: string, timeframe: string) {
  const [feed, setFeed] = useState(() => capture(symbol))
  const [trades, setTrades] = useState<Trade[]>(() => capture(symbol).trades)
  const [candleHistory, setCandleHistory] = useState<{ timeframe: string; candles: Candle[] }>({ timeframe, candles: [] })
  const [history, setHistory] = useState({ loading: false, count: 0, error: '', exhausted: false })
  const [candleError, setCandleError] = useState('')
  const [historyRequest, setHistoryRequest] = useState(0)
  const cursor = useRef<number | null>(null)
  const totalLoaded = useRef(0)
  const stopBackfill = useRef(false)

  useEffect(() => {
    const poll = () => {
      const latest = capture(symbol)
      setFeed(latest)
      setTrades(previous => mergeWhaleTrades(previous, latest.trades).slice(-40000))
    }
    const interval = setInterval(poll, 500)
    return () => clearInterval(interval)
  }, [symbol])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const refresh = async () => {
      try {
        const response = await fetch(`/api/klines?symbol=${symbol}&interval=${timeframe}&limit=500`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]) })
        const data = await response.json()
        if (!response.ok || data.error || !Array.isArray(data.candles)) throw new Error('Candle history unavailable; showing recorded candles')
        if (active) {
          setCandleHistory({ timeframe, candles: data.candles.map((r: number[]) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] })) })
          setCandleError('')
        }
      } catch { if (active) setCandleError('Candle history unavailable; showing recorded candles') }
    }
    refresh()
    const interval = setInterval(refresh, 30000)
    return () => { active = false; controller.abort(); clearInterval(interval) }
  }, [symbol, timeframe])

  useEffect(() => {
    const controller = new AbortController()
    let active = true, delay: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      stopBackfill.current = false
      setHistory(previous => ({ ...previous, loading: true, error: '' }))
      for (let batch = 0; batch < 10 && active && !stopBackfill.current; batch++) {
        try {
          const before = cursor.current
          const response = await fetch(`/api/whales-history?symbol=${symbol}${before !== null ? `&before=${before}` : ''}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]) })
          const page: WhaleHistoryPage = await response.json()
          if (!response.ok || page.symbol !== symbol || !Array.isArray(page.trades)) throw new Error(page.error || 'Trade history unavailable; live recording continues')
          if (!active) return
          setTrades(previous => mergeWhaleTrades(page.trades, previous).slice(-40000))
          totalLoaded.current += page.trades.length
          cursor.current = page.nextBefore
          setHistory({ loading: true, count: Math.min(40000, totalLoaded.current), error: page.error ?? '', exhausted: page.exhausted })
          if (page.error || page.exhausted || !page.trades.length || totalLoaded.current >= 40000 || page.nextBefore === before) break
          // Yield between bounded batches; existing live trades are usable throughout.
          await new Promise<void>(resolve => {
            const done = () => { clearTimeout(delay); controller.signal.removeEventListener('abort', done); resolve() }
            delay = setTimeout(done, 500); controller.signal.addEventListener('abort', done, { once: true })
          })
        } catch (error) {
          if (active) setHistory(previous => ({ ...previous, error: error instanceof Error ? error.message : 'History source unavailable' }))
          break
        }
      }
      if (active) setHistory(previous => ({ ...previous, loading: false }))
    }
    load()
    return () => { active = false; controller.abort(); clearTimeout(delay) }
  }, [symbol, historyRequest])

  const stopHistory = useCallback(() => { stopBackfill.current = true }, [])
  const retryHistory = useCallback(() => { totalLoaded.current = 0; cursor.current = null; setHistoryRequest(n => n + 1) }, [])
  return { feed, trades, candles: candleHistory.timeframe === timeframe ? candleHistory.candles : [], history, candleError, stopHistory, retryHistory }
}
