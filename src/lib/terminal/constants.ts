export const SYMBOLS = [
  { id: 'BTCUSDT', label: 'BTC/USDT', bin: 5, tick: 0.01 },
  { id: 'ETHUSDT', label: 'ETH/USDT', bin: 0.5, tick: 0.01 },
  { id: 'SOLUSDT', label: 'SOL/USDT', bin: 0.05, tick: 0.01 },
  { id: 'BNBUSDT', label: 'BNB/USDT', bin: 0.5, tick: 0.01 },
  { id: 'XRPUSDT', label: 'XRP/USDT', bin: 0.0005, tick: 0.0001 },
  { id: 'DOGEUSDT', label: 'DOGE/USDT', bin: 0.00005, tick: 0.00001 },
] as const

export type SymbolId = (typeof SYMBOLS)[number]['id']

export const TIMEFRAMES = [
  { id: '1m', ms: 60_000 },
  { id: '5m', ms: 300_000 },
  { id: '15m', ms: 900_000 },
  { id: '1h', ms: 3_600_000 },
  { id: '4h', ms: 14_400_000 },
  { id: '1d', ms: 86_400_000 },
] as const
export type TimeframeId = (typeof TIMEFRAMES)[number]['id']

export const TABS = [
  { id: 'chart', label: 'Chart', key: '1', hint: 'Indicators and drawing tools (key 1)' },
  { id: 'heatmap', label: 'Heatmap', key: '2', hint: 'Liquidity heatmap (key 2)' },
  { id: 'footprint', label: 'Footprint', key: '3', hint: 'Footprint (key 3)' },
  { id: 'whales', label: 'Whales', key: '4', hint: 'Whale candles (key 4)' },
  { id: 'profile', label: 'Vol profile', key: '5', hint: 'Volume profile (key 5)' },
  { id: 'gamma', label: 'Gamma', key: '6', hint: 'Gamma levels — options walls, zero-gamma flip, max pain (key 6)' },
  { id: 'tape', label: 'Tape', key: '7', hint: 'Time & sales (key 7)' },
  { id: 'l3', label: 'L3 events', key: '8', hint: 'Liquidity events (L3-style) (key 8)' },
  { id: 'futures', label: 'Futures', key: '9', hint: 'Futures — funding, open interest, liquidation map (key 9)' },
  { id: 'sentiment', label: 'Sentiment', key: '0', hint: 'Sentiment — every reading as a meter, and their consensus (key 0)' },
  { id: 'guide', label: 'Guide', key: 'g', hint: 'Guide' },
] as const

export type TabId = (typeof TABS)[number]['id']

export const GREEN = '#16c784'
export const RED = '#ea3943'
export const AMBER = '#f0b90b'
export const GRID = '#1c1f26'
export const TEXT_DIM = '#8b93a7'

export function symbolMeta(id: string) {
  return SYMBOLS.find((s) => s.id === id) ?? SYMBOLS[0]
}
