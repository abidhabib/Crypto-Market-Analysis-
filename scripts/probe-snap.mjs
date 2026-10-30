import { io } from 'socket.io-client'
const sock = io('http://localhost:3031', { path: '/', transports: ['websocket'] })
let n = 0
sock.on('connect', () => { console.log('connected'); sock.emit('subscribe', { symbol: 'BTCUSDT' }) })
sock.on('snapshot', (s) => {
  n++
  const hc = s.heatCols ?? []
  const total = hc.reduce((a, c) => a + c.bids.length + c.asks.length, 0)
  console.log(`snapshot#${n}: heatCols=${hc.length} avgLv/col=${hc.length ? (total / hc.length).toFixed(0) : 0} trades=${s.trades?.length} klines=${s.klines?.length}`)
  console.log(`  heat JSON approx: ${(JSON.stringify({ heatCols: hc }).length / 1e6).toFixed(2)} MB, full snapshot: ${(JSON.stringify(s).length / 1e6).toFixed(2)} MB`)
  if (n >= 2) { sock.close(); process.exit(0) }
})
sock.on('connect_error', (e) => { console.error('connect_error', e.message); process.exit(1) })
setTimeout(() => { console.log('timeout'); process.exit(1) }, 15000)
