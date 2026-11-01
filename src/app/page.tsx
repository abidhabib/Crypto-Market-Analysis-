import type { Metadata } from 'next'
import Terminal from '@/components/terminal/terminal'

export const metadata: Metadata = {
  title: "FlowLens — by Abid Habib",
  description:
    'Real-time trading analysis terminal: chart, liquidity heatmap, footprint, whale prints, volume profile, options gamma, time & sales, liquidity events, futures and sentiment.',
}

export default function Page() {
  return <Terminal />
}
