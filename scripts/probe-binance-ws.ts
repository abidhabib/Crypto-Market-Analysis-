/** Probe: open the combined Binance spot stream and report raw message shapes. */
const streams = ['btcusdt@aggTrade', 'btcusdt@depth@100ms', 'btcusdt@kline_1m', 'btcusdt@ticker', 'btcusdt@bookTicker'].join('/')
const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
const shapes: Record<string, number> = {}
ws.onmessage = (ev) => {
  try {
    const msg = JSON.parse(ev.data as string)
    const d = msg.data
    if (!d) { shapes['no-data'] = (shapes['no-data'] ?? 0) + 1; return }
    const key = d.e ?? (d.U !== undefined ? 'raw-depth-diff(U,u,b,a)' : d.bids ? 'raw-partial(bids,asks)' : d.b !== undefined && d.a !== undefined ? `raw-bookTicker(b=${typeof d.b})` : JSON.stringify(Object.keys(d)).slice(0, 60))
    shapes[key] = (shapes[key] ?? 0) + 1
  } catch { shapes['parse-error'] = (shapes['parse-error'] ?? 0) + 1 }
}
ws.onerror = () => { console.log('WS ERROR'); }
setTimeout(() => { console.log(JSON.stringify(shapes, null, 1)); process.exit(0) }, 8000)
