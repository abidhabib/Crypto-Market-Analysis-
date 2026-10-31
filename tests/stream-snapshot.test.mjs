import { test } from 'node:test'
import assert from 'node:assert/strict'
import { snapshotHistory } from '../mini-services/terminal-stream/snapshot-history.ts'

const book = t => ({ t, mid: 77000, bids: Array.from({ length: 260 }, (_, i) => ({ p: 77000 - i * 0.01, q: 0.12345678 })), asks: Array.from({ length: 260 }, (_, i) => ({ p: 77000 + i * 0.01, q: 0.87654321 })) })
test('a warm full-depth history fits the startup byte budget and preserves its time bounds', () => {
  const raw = Array.from({ length: 2900 }, (_, i) => book(i * 250))
  const selected = snapshotHistory(raw)
  assert.ok(Buffer.byteLength(JSON.stringify(selected)) <= 384 * 1024)
  assert.ok(selected.length > 1 && selected.length < 800)
  assert.equal(selected[0].t, raw[0].t)
  assert.equal(selected.at(-1).t, raw.at(-1).t)
  for (const col of selected) {
    assert.equal(col.sampled, true)
    assert.deepEqual(col.bids, raw[col.t / 250].bids)
  }
  assert.equal(raw[0].sampled, undefined)
})
test('small histories retain every original observation', () => {
  const raw = [book(0), book(250)]
  assert.deepEqual(snapshotHistory(raw), raw)
  assert.deepEqual(snapshotHistory([]), [])
})
test('unusually large interior books cannot bypass the byte budget', () => {
  const raw = Array.from({ length: 50 }, (_, i) => ({ t: i, payload: i === 20 ? 'x'.repeat(100000) : 'x' }))
  assert.ok(Buffer.byteLength(JSON.stringify(snapshotHistory(raw, 1024))) <= 1024)
  assert.deepEqual(snapshotHistory([{ t: 0, payload: 'x'.repeat(1000) }], 64), [])
})
