'use client'

import { TIMEFRAMES } from '@/lib/terminal/constants'
import { cn } from '@/lib/utils'

const common = new Set(['1m', '5m', '15m', '1h', '4h', '1d'])

export default function TimeframePicker({ value, onChange, label = 'Candle interval' }: {
  value: string; onChange: (id: string, ms: number) => void; label?: string
}) {
  return <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-slate-700/70 bg-[#101a28] p-0.5">
    {TIMEFRAMES.filter(t => common.has(t.id)).map(t => <button key={t.id} type="button" aria-pressed={value === t.id} onClick={() => onChange(t.id, t.ms)} className={cn('min-h-8 rounded-md px-2 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-400', value === t.id ? 'bg-sky-400/20 text-sky-200' : 'text-slate-400 hover:bg-white/5 hover:text-white')}>{t.id}</button>)}
    <select aria-label={`${label}: more intervals`} value={common.has(value) ? '' : value} onChange={e => { const t = TIMEFRAMES.find(t => t.id === e.target.value); if (t) onChange(t.id, t.ms) }} className={cn('min-h-8 max-w-24 rounded-md border-0 bg-[#182334] px-1.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-sky-400', common.has(value) ? 'text-slate-400' : 'text-sky-200')}>
      <option value="" disabled>More</option>
      {TIMEFRAMES.filter(t => !common.has(t.id)).map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
    </select>
  </div>
}
