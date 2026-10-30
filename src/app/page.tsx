import type { Metadata } from 'next'
import Terminal from '@/components/terminal/terminal'

export const metadata: Metadata = {
  title: "OrderFlow Terminal — by <3 abidhabib",
  description:
    'Real-time trading analysis terminal: chart, liquidity heatmap, footprint, whale prints, volume profile, options gamma, time & sales, liquidity events, futures and sentiment.',
}

export default function Page() {
  return <Terminal />
}
