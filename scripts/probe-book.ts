/** Probe: subscribe BTCUSDT on the stream service and report which events arrive. */
import { io } from 'socket.io-client'

const socket = io('http://localhost:3031', { path: '/', transports: ['websocket'] })
const counts: Record<string, number> = {}
let snap: any = null

socket.on('connect', () => {
  console.log('connected')
  socket.emit('subscribe', { symbol: 'BTCUSDT' })
})
socket.on('snapshot', (s: any) => {
  snap = s
  console.log('snapshot:', JSON.stringify({
    status: s.status,
    err: s.lastError,
    trades: s.trades?.length,
    klines: s.klines?.length,
    hasDepth: !!s.depth,
    hasLadder: !!s.ladder,
    heatCols: s.heatCols?.length,
    walls: s.walls?.length,
  }))
})
;['depth', 'bookTop', 'ladder-col', 'trade', 'kline', 'ticker', 'walls', 'pull', 'sweep', 'status'].forEach((ev) => {
  socket.on(ev, () => { counts[ev] = (counts[ev] ?? 0) + 1 })
})
socket.on('status', (e: any) => console.log('status:', JSON.stringify(e)))

setTimeout(() => {
  console.log('event counts:', JSON.stringify(counts))
  if (snap) console.log('final snapshot hasDepth:', !!snap.depth, 'heatCols:', snap.heatCols?.length)
  process.exit(0)
}, 12_000)
