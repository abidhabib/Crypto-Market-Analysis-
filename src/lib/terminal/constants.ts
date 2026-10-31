export const SYMBOLS = [
  { id: 'BTCUSDT', label: 'BTC/USDT', bin: 5, tick: 0.01 },
  { id: 'ETHUSDT', label: 'ETH/USDT', bin: 0.5, tick: 0.01 },
  { id: 'SOLUSDT', label: 'SOL/USDT', bin: 0.05, tick: 0.01 },
  { id: 'BNBUSDT', label: 'BNB/USDT', bin: 0.5, tick: 0.01 },
  { id: 'XRPUSDT', label: 'XRP/USDT', bin: 0.0005, tick: 0.0001 },
  { id: 'DOGEUSDT', label: 'DOGE/USDT', bin: 0.00005, tick: 0.00001 },
  { id: 'ADAUSDT', label: 'ADA/USDT', bin: 0.0005, tick: 0.0001 },
  { id: 'AVAXUSDT', label: 'AVAX/USDT', bin: 0.05, tick: 0.01 },
  { id: 'LINKUSDT', label: 'LINK/USDT', bin: 0.005, tick: 0.001 },
  { id: 'LTCUSDT', label: 'LTC/USDT', bin: 0.05, tick: 0.01 },
  { id: 'TRXUSDT', label: 'TRX/USDT', bin: 0.00005, tick: 0.00001 },
  { id: 'SUIUSDT', label: 'SUI/USDT', bin: 0.0005, tick: 0.0001 },
] as const

export type SymbolId = (typeof SYMBOLS)[number]['id']

// Fallback tick heuristic by price magnitude (refined at runtime via
// /api/symbol-info when the user picks a symbol outside the defaults).
export function heuristicTick(price: number): number {
  if (price >= 1000) return 0.01
  if (price >= 10) return 0.001
  if (price >= 0.1) return 0.0001
  if (price >= 0.01) return 0.00001
  if (price >= 0.0001) return 0.000001
  return 0.0000001
}

// Runtime-refined tick sizes (from /api/symbol-info) beat the heuristic.
const tickOverrides = new Map<string, number>()
export function setTickOverride(symbol: string, tick: number) {
  if (isFinite(tick) && tick > 0) tickOverrides.set(symbol.toUpperCase(), tick)
}

export function metaFor(id: string, lastPrice?: number): { id: string; label: string; bin: number; tick: number } {
  const known = SYMBOLS.find((s) => s.id === id)
  const tick = tickOverrides.get(id.toUpperCase()) ?? known?.tick ?? heuristicTick(lastPrice || 1)
  if (known) return { ...known, tick }
  const price = lastPrice ?? 0
  const base = price || 1
  const bin = Math.max(tick * 2, base * 6.5e-5)
  return { id, label: id.replace('USDT', '/USDT'), bin, tick }
}

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
  { id: 'chart', label: 'Chart', key: '1', hint: 'Pro chart — indicators and drawing tools (key 1)' },
  { id: 'bubbles', label: 'Crypto Bubbles', key: 'c', hint: 'Live interactive Crypto Bubbles market view (key C)' },
  { id: 'heatmap', label: 'Heatmap', key: '2', hint: 'Liquidity heatmap — depth, trade bubbles, spoof detection (key 2)' },
  { id: 'footprint', label: 'Footprint', key: '3', hint: 'Footprint (key 3)' },
  { id: 'whales', label: 'Whales', key: '4', hint: 'Large execution bubbles, buyer/seller VWAP, zones and net flow (key 4)' },
  { id: 'profile', label: 'Vol profile', key: '5', hint: 'Volume profile (key 5)' },
  { id: 'gamma', label: 'Gamma', key: '6', hint: 'Gamma levels — options walls, zero-gamma flip, max pain (key 6)' },
  { id: 'tape', label: 'Tape', key: '7', hint: 'Time & sales (key 7)' },
  { id: 'l3', label: 'L3 events', key: '8', hint: 'Liquidity events (L3-style) (key 8)' },
  { id: 'futures', label: 'Futures', key: '9', hint: 'Futures — funding, open interest, liquidation map (key 9)' },
  { id: 'sentiment', label: 'Sentiment', key: '0', hint: 'Sentiment — every reading as a meter, and their consensus (key 0)' },
  { id: 'signals', label: 'Signals', key: 's', hint: 'Market prediction — trend, strength, R/R checklist, toxicity (key S)' },
  { id: 'insights', label: 'Insights', key: 'i', hint: 'Market insights — auto-generated analysis feed & key levels (key I)' },
  { id: 'guide', label: 'Guide', key: 'g', hint: 'Shortcuts & methodology' },
] as const

export type TabId = (typeof TABS)[number]['id']

export const GREEN = '#16c784'
export const RED = '#ea3943'
export const AMBER = '#f0b90b'
export const GRID = '#1c1f26'
export const TEXT_DIM = '#8b93a7'

export function symbolMeta(id: string): { id: string; label: string; bin: number; tick: number } {
  // delegates to metaFor so scanner-picked symbols (outside the defaults)
  // still get sensible tick/bin metadata everywhere in the terminal
  return metaFor(id)
}
