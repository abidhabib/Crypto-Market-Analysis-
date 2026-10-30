const ws = new WebSocket('wss://fstream.binance.com/stream?streams=btcusdt@markPrice@1s/btcusdt@forceOrder')
let n = 0
ws.onopen = () => console.log('FUT_WS_OPEN')
ws.onmessage = (ev) => { n++; if (n <= 2) console.log('msg:', String(ev.data).slice(0, 140)) }
ws.onerror = () => console.log('FUT_WS_ERROR')
ws.onclose = (e) => console.log('FUT_WS_CLOSE', e.code, e.reason)
setTimeout(() => { console.log('messages received:', n); process.exit(0) }, 8000)
