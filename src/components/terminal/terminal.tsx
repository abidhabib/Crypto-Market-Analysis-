'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Mail, Globe } from 'lucide-react'
import { useTerminal } from '@/lib/terminal/store'
import { getStream, subscribeStream } from '@/lib/terminal/stream-client'
import { useHotkeys, usePoll } from '@/lib/terminal/hooks'
import { TABS, type TabId } from '@/lib/terminal/constants'
import TopBar from './top-bar'
import TabBar from './tab-bar'
import OrderBookRail from './order-book-rail'

const ChartPanel = dynamic(() => import('./panel-chart'), { ssr: false })
const HeatmapPanel = dynamic(() => import('./panel-heatmap'), { ssr: false })
const FootprintPanel = dynamic(() => import('./panel-footprint'), { ssr: false })
const WhalesPanel = dynamic(() => import('./panel-whales'), { ssr: false })
const ProfilePanel = dynamic(() => import('./panel-profile'), { ssr: false })
const GammaPanel = dynamic(() => import('./panel-gamma'), { ssr: false })
const TapePanel = dynamic(() => import('./panel-tape'), { ssr: false })
const L3Panel = dynamic(() => import('./panel-l3'), { ssr: false })
const FuturesPanel = dynamic(() => import('./panel-futures'), { ssr: false })
const SentimentPanel = dynamic(() => import('./panel-sentiment'), { ssr: false })
const SignalsPanel = dynamic(() => import('./panel-signals'), { ssr: false })
const InsightsPanel = dynamic(() => import('./panel-insights'), { ssr: false })
const GuidePanel = dynamic(() => import('./panel-guide'), { ssr: false })
const CryptoBubblesPanel = dynamic(() => import('./panel-crypto-bubbles'), { ssr: false })
const MarketPicker = dynamic(() => import('./market-picker'), { ssr: false })

function ActivePanel({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'chart': return <ChartPanel />
    case 'heatmap': return <HeatmapPanel />
    case 'footprint': return <FootprintPanel />
    case 'whales': return <WhalesPanel />
    case 'profile': return <ProfilePanel />
    case 'gamma': return <GammaPanel />
    case 'tape': return <TapePanel />
    case 'l3': return <L3Panel />
    case 'futures': return <FuturesPanel />
    case 'sentiment': return <SentimentPanel />
    case 'signals': return <SignalsPanel />
    case 'insights': return <InsightsPanel />
    case 'bubbles': return <CryptoBubblesPanel />
    case 'guide': return <GuidePanel />
    default: return null
  }
}

const RAIL_TABS = new Set<TabId>(['chart', 'profile', 'tape', 'l3', 'signals'])

export default function Terminal() {
  const { tab, setTab, railOpen, toggleRail } = useTerminal()
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')
  // Sync progress while the feed warms up: which pieces have actually
  // arrived, so "CONNECTING" is a measurable state, not a dead end. The
  // socket reconnects on its own; no reload is ever required.
  const sync = usePoll(() => {
    const s = getStream()
    // A checkmark means the data is HERE and FRESH — a buffer that arrived
    // minutes ago and then went silent must not keep claiming ✓.
    const fresh = Date.now() - s.lastMsgAt < 15_000 && s.lastMsgAt > 0
    const tradesFresh = Date.now() - s.lastTradeReceivedAt < 15_000 && s.lastTradeReceivedAt > 0
    return {
      status: s.status,
      candles: fresh ? s.klines.length : 0,
      book: !!s.depth && fresh,
      trades: tradesFresh ? s.trades.length : 0,
      snapshot: s.hasSnapshot,
      error: s.lastError,
    }
  }, 500)

  useEffect(() => {
    setStatus(getStream().status)
    const un = subscribeStream(() => setStatus(getStream().status))
    return () => { un() }
  }, [])

  useHotkeys((key) => {
    const t = TABS.find((x) => x.key === key)
    if (t) setTab(t.id)
    else if (key === 'b' && RAIL_TABS.has(tab)) toggleRail()
  })

  const showRail = railOpen && RAIL_TABS.has(tab)

  return (
    <div className="trading-terminal dark flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <TopBar status={status} />
      {status !== 'live' && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-[#f0b90b]/25 bg-[#f0b90b]/5 px-3 py-1 font-mono text-[10px] text-[#f0b90b]" role="status">
          <span>{status === 'offline' ? 'FEED OFFLINE — reconnecting automatically' : 'SYNCING MARKET FEED'}</span>
          <span className="text-muted-foreground">snapshot {sync.snapshot ? '✓' : '…'}</span>
          <span className="text-muted-foreground">candles {sync.candles > 0 ? `✓ ${sync.candles}` : '…'}</span>
          <span className="text-muted-foreground">order book {sync.book ? '✓' : '…'}</span>
          <span className="text-muted-foreground">trades {sync.trades > 0 ? `✓ ${sync.trades}` : '…'}</span>
          {sync.error && <span className="text-[#ea3943]">{sync.error}</span>}
        </div>
      )}
      <TabBar />
      <main className="flex min-h-0 flex-1" role="main">
        <section className="min-w-0 flex-1" aria-label={`${tab} panel`}>
          <ActivePanel tab={tab} />
        </section>
        {showRail && (
          <aside className="hidden w-[248px] shrink-0 border-l border-border/60 bg-[#111111] xl:block" aria-label="Order book and last trades">
            <OrderBookRail />
          </aside>
        )}
      </main>
      <MarketPicker />
      <footer className="flex h-8 shrink-0 items-center justify-center gap-3 border-t border-amber-400/15 bg-[#111111] px-3 font-mono text-[10px] text-neutral-400 sm:gap-5" role="contentinfo">
        <span className="shrink-0 font-medium text-amber-300">Abid Habib</span>
        <div className="flex items-center gap-3 sm:gap-5">
          <a href="mailto:abid.habib@outlook.com" aria-label="Email Abid Habib at abid.habib@outlook.com" title="abid.habib@outlook.com" className="inline-flex min-h-8 items-center gap-1.5 transition-colors hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400">
            <Mail size={12} className="text-amber-400/80" aria-hidden="true" /><span className="hidden sm:inline">abid.habib@outlook.com</span><span className="sm:hidden">Email</span>
          </a>
          <a href="https://abidhabib.pro" aria-label="Abid Habib's website" className="inline-flex min-h-8 items-center gap-1.5 transition-colors hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400">
            <Globe size={12} className="text-amber-400/80" aria-hidden="true" /><span className="hidden sm:inline">abidhabib.pro</span><span className="sm:hidden">Website</span>
          </a>
        </div>
      </footer>
    </div>
  )
}
