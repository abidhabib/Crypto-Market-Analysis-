export interface Trade { a: number; p: number; q: number; t: number; m: boolean }
export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface Level { p: number; q: number }
export interface HeatCol {
  t: number; mid: number; bids: Level[]; asks: Level[]
  bookMode?: 'synced' | 'partial' | 'unknown'
  sourceAt?: number
  bookEpoch?: number
  sampled?: boolean
}
export interface Liq { t: number; side: 'BUY' | 'SELL'; p: number; q: number }
export interface Ticker { c: number; P: number; h: number; l: number; v: number; q: number; b: number; a: number }
export interface Mark { p: number; funding: number; nextFunding: number; index: number }
export interface WallRec { side: 'bid' | 'ask'; p: number; q: number; firstSeen: number; pulls: number; maxQ: number }
export interface PullEv { t: number; side: 'bid' | 'ask'; p: number; size: number; lasted: number; count: number }
export interface SweepEv { t: number; side: 'bid' | 'ask'; p: number; size: number; trade: number }
export interface IceEv { t: number; side: 'bid' | 'ask'; p: number; size: number; refills: number }

export interface Snapshot {
  symbol: string
  serverTime: number
  status: 'connecting' | 'live' | 'offline'
  lastError: string | null
  trades: Trade[]
  klines: Candle[]
  ticker: Ticker | null
  depth: { bids: Level[]; asks: Level[] } | null
  ladder: { bids: Level[]; asks: Level[]; t: number } | null
  heatCols: HeatCol[]
  mark: Mark | null
  oi: { oi: number; t: number } | null
  liqs: Liq[]
  walls: WallRec[]
  pulls: PullEv[]
  sweeps: SweepEv[]
  icebergs: IceEv[]
}

export interface StrikeGex {
  strike: number
  callGex: number
  putGex: number
  gex: number
  callOi: number
  putOi: number
}
export interface GammaDetail {
  expiry: number
  dte: number
  strikes: StrikeGex[]
  cum: { strike: number; cum: number }[]
  flip: number | null
  maxPain: number | null
  walls: { strike: number; gex: number; side: string }[]
  totalCallOi: number
  totalPutOi: number
  netGex: number
}
export interface GammaData {
  currency: string
  spot: number
  asOf: number
  expiries: { expiry: number; dte: number }[]
  details: GammaDetail[]
}

export interface SentimentData {
  fng: { value: number; label: string | null; ts: number | null; history: { t: number; v: number }[] }
  globalLongShort: { ratio: number; longPct: number; t: number } | null
  topLongShort: { ratio: number; longPct: number; t: number } | null
  takerFlow: { buySellRatio: number; t: number } | null
  asOf: number
}

export interface FuturesHistory {
  symbol: string
  funding: { t: number; rate: number }[]
  oiHistory: { t: number; oi: number; usd: number }[]
  asOf: number
}

export type L3Type = 'wall' | 'pull' | 'sweep' | 'iceberg'
export interface L3Event {
  id: string
  t: number
  type: L3Type
  side: 'bid' | 'ask'
  price: number
  size: number
  note: string
}
