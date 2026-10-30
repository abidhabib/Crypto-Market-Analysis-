async function test(name: string, url: string, ms: number) {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(url)
    let n = 0
    ws.onopen = () => console.log(name, 'OPEN')
    ws.onmessage = (ev) => { n++; if (n <= 1) console.log(name, 'first msg:', String(ev.data).slice(0, 100)) }
    ws.onerror = () => console.log(name, 'ERROR')
    ws.onclose = (e) => { if (n === 0) console.log(name, 'CLOSE', e.code) }
    setTimeout(() => { console.log(name, 'total:', n); ws.close(); resolve() }, ms)
  })
}
await test('combined-markPrice', 'wss://fstream.binance.com/stream?streams=btcusdt@markPrice@1s', 6000)
await test('raw-markPrice', 'wss://fstream.binance.com/ws/btcusdt@markPrice@1s', 6000)
await test('raw-aggTrade', 'wss://fstream.binance.com/ws/btcusdt@aggTrade', 6000)
await test('raw-bookTicker', 'wss://fstream.binance.com/ws/btcusdt@bookTicker', 6000)
