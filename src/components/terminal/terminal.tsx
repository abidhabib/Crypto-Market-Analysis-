'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { useTerminal } from '@/lib/terminal/store'
import { getStream, subscribeStream } from '@/lib/terminal/stream-client'
import { useHotkeys } from '@/lib/terminal/hooks'
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

const RAIL_TABS = new Set<TabId>(['chart', 'footprint', 'profile', 'tape', 'l3', 'signals'])

export default function Terminal() {
  const { tab, setTab, railOpen, toggleRail } = useTerminal()
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting')

  useEffect(() => {
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
      <footer className="flex h-6 shrink-0 items-center gap-3 overflow-x-auto border-t border-border/60 bg-[#111111] px-3 text-[10px] text-muted-foreground" role="contentinfo">
        <span>keys: <kbd className="rounded bg-muted px-1 font-mono">1–9,0</kbd> tabs · <kbd className="rounded bg-muted px-1 font-mono">G</kbd> guide · {tab === 'bubbles' ? 'C: Crypto Bubbles · use the controls inside the view' : tab === 'heatmap' ? 'Columns menu: aligned book & tape' : tab === 'whales' ? 'Whales: hover / tap bubbles · Home: live' : <><kbd className="rounded bg-muted px-1 font-mono">B</kbd> book rail</>}</span>
        <span className="hidden sm:inline">{tab === 'bubbles' ? 'source: cryptobubbles.net · independent market feed' : 'sources: Binance spot & futures · Deribit · alternative.me'}</span>
        <span className="ml-auto hidden shrink-0 xl:inline">estimates: liquidation map, L3-style events — see Guide</span>
      </footer>
    </div>
  )
}
