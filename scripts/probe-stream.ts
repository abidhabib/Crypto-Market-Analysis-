// probe: connect to terminal-stream and verify live data arrives
import { io } from 'socket.io-client'
const socket = io('http://localhost:3031', { path: '/', reconnectionAttempts: 2, timeout: 8000 })
const done = (msg: string) => { console.log(msg); process.exit(0) }
socket.on('connect', () => socket.emit('subscribe', { symbol: 'BTCUSDT' }))
socket.on('snapshot', (s: any) => {
  console.log('snapshot:', s.symbol, 'klines:', s.klines?.length, 'trades:', s.trades?.length,
    'ticker:', s.ticker ? 'yes' : 'no', 'mark:', s.mark ? JSON.stringify(s.mark) : 'no', 'status:', s.status)
  if (s.klines?.length > 0 && s.trades?.length > 0) done('SNAPSHOT_OK')
})
socket.on('status', (e: any) => console.log('status:', JSON.stringify(e)))
setTimeout(() => done('TIMEOUT_NO_SNAPSHOT'), 20000)
