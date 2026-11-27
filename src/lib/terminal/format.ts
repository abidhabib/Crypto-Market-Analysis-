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

/** All terminal times are UTC. fmtTime renders a UTC wall-clock time. */
export function fmtTime(ts: number | null | undefined, withSeconds = true): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return withSeconds
    ? `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
    : `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** UTC time with an explicit zone label, for standalone timestamps. */
export function fmtClock(ts: number | null | undefined): string {
  if (!ts) return '—'
  return `${fmtTime(ts)} UTC`
}

/**
 * Adaptive-precision quantity: ~3 significant digits so small sizes never
 * collapse to "0.00" (0.0042 BTC stays "0.00420", 1.234 → "1.23").
 */
export function fmtQty(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1000) return fmtCompact(v)
  const dp = Math.min(8, Math.max(0, 2 - Math.floor(Math.log10(abs))))
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

export function fmtPct(v: number | null | undefined, dp = 2): string {
  if (v == null || !isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(dp)}%`
}

export function fmtSigned(v: number | null | undefined, dp = 2): string {
  if (v == null || !isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`
}
