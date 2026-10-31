import { Buffer } from 'node:buffer'

/** Preserve observed books across the recorded window without a multi-MB startup frame. */
export function snapshotHistory<T extends { t: number; sampled?: boolean }>(
  raw: readonly T[], budget = 384 * 1024, maxColumns = 800,
): T[] {
  if (!raw.length || budget < 2 || maxColumns < 1) return []
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
  const largestProbe = Math.max(...[raw[0], raw[Math.floor(raw.length / 2)], raw[raw.length - 1]].map(bytes)) + 20
  let count = Math.min(raw.length, maxColumns, Math.max(1, Math.floor((budget - 2) / largestProbe)))
  while (count > 0) {
    const sampled = count < raw.length
    const selected = Array.from({ length: count }, (_, i) => {
      const index = count === 1 ? raw.length - 1 : Math.round(i * (raw.length - 1) / (count - 1))
      return sampled ? { ...raw[index], sampled: true } : raw[index]
    })
    const size = bytes(selected)
    if (size <= budget) return selected
    count = Math.min(count - 1, Math.floor(count * budget / size))
  }
  return []
}
