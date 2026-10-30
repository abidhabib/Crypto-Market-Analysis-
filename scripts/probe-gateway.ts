// probe gateway variants to find why browser socket fails
import { io } from 'socket.io-client'

const mode = process.argv[2] || 'a'
const url = 'http://localhost:81'
const done = (m: string) => { console.log(mode, '→', m); process.exit(0) }

const socket =
  mode === 'a'
    ? io(`${url}/?XTransformPort=3031`, { transports: ['websocket', 'polling'], path: '/', forceNew: true, timeout: 8000 })
    : mode === 'b'
      ? io(`${url}/?XTransformPort=3031`, { transports: ['websocket', 'polling'], forceNew: true, timeout: 8000 })
      : mode === 'c'
        ? io(`${url}/?XTransformPort=3031`, { transports: ['polling', 'websocket'], forceNew: true, timeout: 8000 })
        : io(`${url}/?XTransformPort=3031`, { transports: ['polling'], forceNew: true, timeout: 8000 })

socket.on('connect', () => { console.log(mode, 'connected! sid=', socket.id?.slice(0, 6), 'transport=', socket.io.engine.transport?.name); socket.emit('subscribe', { symbol: 'BTCUSDT' }) })
socket.on('snapshot', (s: any) => { if (s?.klines?.length) done(`SNAPSHOT with ${s.klines.length} klines`) })
socket.on('connect_error', (e: Error) => console.log(mode, 'connect_error:', e.message))
socket.on('disconnect', (r) => console.log(mode, 'disconnect:', r))
setTimeout(() => done('TIMEOUT'), 12000)
