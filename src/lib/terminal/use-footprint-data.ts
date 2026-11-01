'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getStream, now } from './stream-client'
import { mergeFootprintTrades } from './footprint-model'
import type { Trade } from './types'
import type { WhaleHistoryPage } from './whales-history'

function capture(symbol: string) {
  const s = getStream(), same = s.symbol === symbol
  return { trades: same ? s.trades.slice() : [] as Trade[], asOf: now(), status: same ? s.status : 'connecting', receivedAt: same ? s.lastTradeReceivedAt : 0, clientNow: Date.now() }
}

/** Reuses the bounded, cached aggregate-trade endpoint; never reconstructs flow from candles. */
export function useFootprintData(symbol: string) {
  const recording = useRef<Trade[]>([])
  const [data, setData] = useState(() => capture(symbol))
  const [history, setHistory] = useState({ loading: true, error: '', exhausted: false })
  const [request, setRequest] = useState(0)
  const cursor = useRef<number | null>(null)
  useEffect(() => {
    const timer = setInterval(() => {
      const latest = capture(symbol)
      recording.current = mergeFootprintTrades(recording.current, latest.trades).slice(-40000)
      setData({ ...latest, trades: recording.current })
    }, 500)
    return () => clearInterval(timer)
  }, [symbol])
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const load = async () => {
      setHistory(h => ({ ...h, loading: true, error: '' }))
      try {
        const before = cursor.current
        const response = await fetch(`/api/whales-history?symbol=${symbol}${before === null ? '' : `&before=${before}`}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(22000)]) })
        const page: WhaleHistoryPage = await response.json()
        if (!response.ok || page.symbol !== symbol || !Array.isArray(page.trades)) throw new Error(page.error || 'History unavailable; live recording continues')
        if (!active) return
        recording.current = mergeFootprintTrades(page.trades, recording.current, capture(symbol).trades).slice(-40000)
        cursor.current = page.nextBefore
        setData({ ...capture(symbol), trades: recording.current })
        setHistory({ loading: false, error: page.error || '', exhausted: page.exhausted || recording.current.length >= 40000 || (before !== null && page.nextBefore === before) })
      } catch (e) { if (active) setHistory(h => ({ ...h, loading: false, error: e instanceof Error ? e.message : 'History unavailable' })) }
    }
    load()
    return () => { active = false; controller.abort() }
  }, [symbol, request])
  const loadMore = useCallback(() => setRequest(n => n + 1), [])
  return { data, history, loadMore }
}
