import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWhaleHistory } from '../src/lib/terminal/whales-history.ts'

const row = a => ({ a, p: '100', q: '2', T: 1000 + a, m: false })
test('history pages go backward by inclusive IDs without duplicate or forward rows', async () => {
  const urls = []
  const fetcher = async url => {
    urls.push(new URL(url))
    const from = Number(new URL(url).searchParams.get('fromId') || 2001)
    return Response.json(Array.from({ length: 1000 }, (_, i) => row(from + i)))
  }
  const result = await fetchWhaleHistory('BTCUSDT', null, 3, fetcher)
  assert.equal(result.trades.length, 3000); assert.equal(new Set(result.trades.map(t => t.a)).size, 3000)
  assert.deepEqual(urls.map(u => u.searchParams.get('fromId')), [null, '1001', '1'])
  assert.equal(result.nextBefore, 1); assert.equal(result.exhausted, true)
})
test('an interrupted history load retains successful pages instead of claiming a complete window', async () => {
  let calls = 0
  const result = await fetchWhaleHistory('BTCUSDT', null, 4, async () => {
    if (calls++ === 0) return Response.json([row(2000), row(2001)])
    throw new Error('network unavailable')
  })
  assert.equal(result.trades.length, 2); assert.equal(result.nextBefore, 2000)
  assert.equal(result.exhausted, false); assert.match(result.error, /network unavailable/)
})
test('rate limits stop pagination and do not probe the alternate endpoint', async () => {
  let calls = 0
  const result = await fetchWhaleHistory('BTCUSDT', null, 4, async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '90' } }) })
  assert.equal(calls, 1); assert.equal(result.retryAfter, 90); assert.equal(result.trades.length, 0)
})
test('malformed rows and records at or beyond an exclusive cursor cannot contaminate the result', async () => {
  const result = await fetchWhaleHistory('BTCUSDT', 100, 1, async () => Response.json([row(98), row(99), row(100), { ...row(97), m: 'false' }, { ...row(96), q: '-1' }]))
  assert.deepEqual(result.trades.map(t => t.a), [98, 99])
})
