'use client'

import { cn } from '@/lib/utils'
import { fmtClock } from '@/lib/terminal/format'
import { AMBER, GREEN, RED } from '@/lib/terminal/constants'

export function PanelHeader({ title, sub, right, source }: {
  title: string
  sub?: string
  right?: React.ReactNode
  source?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 px-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-tight">{title}</div>
        {sub && <div className="hidden text-[11px] text-muted-foreground leading-tight sm:block">{sub}</div>}
      </div>
      <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">{right}</div>
      {source && <div className="hidden text-[10px] uppercase tracking-wide text-muted-foreground/70 sm:block">{source}</div>}
    </div>
  )
}

export function StatCard({ label, value, sub, tone }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'up' | 'down' | 'neutral'
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/60 px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-semibold truncate font-mono',
        tone === 'up' && 'text-[#16c784]', tone === 'down' && 'text-[#ea3943]')}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
    </div>
  )
}

export function Tone({ v, children, reverse }: { v: number; children: React.ReactNode; reverse?: boolean }) {
  const up = reverse ? v < 0 : v > 0
  const down = reverse ? v > 0 : v < 0
  return (
    <span className={cn('font-mono', up && 'text-[#16c784]', down && 'text-[#ea3943]')}>{children}</span>
  )
}

export function SourceBadge({ label, tone = 'live' }: { label: string; tone?: 'live' | 'est' | 'off' }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider border',
      tone === 'live' && 'border-[#16c784]/40 text-[#16c784] bg-[#16c784]/10',
      tone === 'est' && 'border-[#f0b90b]/40 text-[#f0b90b] bg-[#f0b90b]/10',
      tone === 'off' && 'border-border text-muted-foreground bg-muted/40',
    )}>
      <span className={cn('size-1.5 rounded-full',
        tone === 'live' && 'bg-[#16c784]', tone === 'est' && 'bg-[#f0b90b]', tone === 'off' && 'bg-muted-foreground')} />
      {label}
    </span>
  )
}

export function AsOf({ ts }: { ts: number | null | undefined }) {
  if (!ts) return null
  return <span className="text-[10px] text-muted-foreground">as of {fmtClock(ts)}</span>
}

export const toneColor = (v: number) => (v > 0 ? GREEN : v < 0 ? RED : AMBER)

export function Meter({ label, value, display, min, max, tone, note }: {
  label: string
  value: number        // -100..100
  display: React.ReactNode
  min?: number
  max?: number
  tone?: 'up' | 'down' | 'neutral'
  note?: string
}) {
  const lo = min ?? -100, hi = max ?? 100
  const pct = Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100))
  const color = tone === 'up' ? GREEN : tone === 'down' ? RED : '#8b93a7'
  return (
    <div className="rounded-md border border-border/60 bg-card/60 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-sm font-semibold" style={{ color }}>{display}</span>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <div
          className="absolute inset-y-0 rounded-full transition-[left] duration-500"
          style={{
            left: `${Math.min(50, pct)}%`,
            width: `${Math.abs(pct - 50)}%`,
            background: color,
          }}
        />
      </div>
      {note && <div className="mt-1.5 text-[10px] leading-snug text-muted-foreground">{note}</div>}
    </div>
  )
}
