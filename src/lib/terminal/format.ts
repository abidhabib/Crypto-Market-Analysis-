export function fmtPrice(v: number | null | undefined, tick = 0.1): string {
  if (v == null || !isFinite(v)) return '—'
  const dp = Math.max(0, Math.min(8, Math.ceil(-Math.log10(tick))))
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

export function fmtNum(v: number | null | undefined, dp = 2): string {
  if (v == null || !isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

export function fmtCompact(v: number | null | undefined, prefix = ''): string {
  if (v == null || !isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${prefix}${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${prefix}${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${prefix}${(v / 1e3).toFixed(1)}K`
  return `${prefix}${v.toFixed(abs < 10 ? 2 : 0)}`
}

export function fmtUsd(v: number | null | undefined): string {
  return fmtCompact(v, '$')
}

export function fmtTime(ts: number | null | undefined, withSeconds = true): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return withSeconds
    ? `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    : `${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtClock(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false })
}

export function fmtPct(v: number | null | undefined, dp = 2): string {
  if (v == null || !isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`
}

export function fmtSigned(v: number | null | undefined, dp = 2): string {
  if (v == null || !isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`
}
