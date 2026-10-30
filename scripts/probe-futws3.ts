async function test(name: string, url: string, ms: number) {
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(url)
    let n = 0
    ws.onmessage = (ev) => { n++; if (n <= 1) console.log(name, 'first:', String(ev.data).slice(0, 90)) }
    ws.onerror = () => console.log(name, 'ERROR')
    setTimeout(() => { console.log(name, 'total:', n); ws.close(); resolve() }, ms)
  })
}
await test('markPrice-nosuffix', 'wss://fstream.binance.com/ws/btcusdt@markPrice', 5000)
await test('kline_1m', 'wss://fstream.binance.com/ws/btcusdt@kline_1m', 5000)
await test('depth20', 'wss://fstream.binance.com/ws/btcusdt@depth20@100ms', 5000)
await test('forceOrder', 'wss://fstream.binance.com/ws/btcusdt@forceOrder', 8000)
