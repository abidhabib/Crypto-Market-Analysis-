'use client'

import { Pause, Play, SkipBack, SkipForward, Radio, ShieldCheck } from 'lucide-react'
import { reactionCodes, reactionColors, reactionLabels, type depthQuality, type HeatmapReaction } from '@/lib/terminal/heatmap-model'
import { fmtCompact, fmtPrice } from '@/lib/terminal/format'

const utc = (t: number) => new Date(t).toISOString().slice(11, 19)
const duration = (t: number) => t >= 60000 ? `${(t / 60000).toFixed(1)}m` : `${Math.floor(t / 1000)}s`

export function DataQualityStrip({ quality: q, connected, span, historical, tradeMs, tradeCount }: {
  quality: ReturnType<typeof depthQuality>; connected: boolean; span: number; historical: boolean; tradeMs: number; tradeCount: number
}) {
  const stale = q.ageMs === null || q.ageMs > 5000 || !connected
  const limited = stale || q.mode !== 'synced' || q.gaps > 0 || q.resets > 0
  return <details className="shrink-0 border-b border-white/[0.07] bg-[#0c1420] px-4 py-2 text-[10px]" data-testid="heatmap-quality">
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
      <span className={limited ? 'flex items-center gap-1.5 text-amber-300' : 'flex items-center gap-1.5 text-emerald-300'}><ShieldCheck size={12} />{historical ? 'Snapshot quality' : 'Data quality'}</span>
      <span>{q.mode === 'synced' ? 'Synced L2 book' : q.mode === 'partial' ? 'Partial top-20 book' : 'Book mode unknown'}</span>
      <span className={stale ? 'text-amber-300' : ''}>{!connected ? 'Feed disconnected' : q.ageMs === null ? 'No depth yet' : `Depth age ${(q.ageMs / 1000).toFixed(1)}s${stale ? ' · delayed' : ''}`}</span>
      <span>Recorded {duration(q.recordedMs)} / {duration(span)}</span>
      <span className={q.gaps ? 'text-amber-300' : ''}>{q.gaps} gap{q.gaps === 1 ? '' : 's'}{q.resets ? ` · ${q.resets} book rebuild${q.resets === 1 ? '' : 's'}` : ''}</span>
      {q.sampled && <span>Sampled history</span>}<span className="ml-auto text-slate-600">Details</span>
    </summary>
    <div className="mt-2 max-w-3xl space-y-1 text-[11px] leading-relaxed text-slate-500">
      <p>Depth age measures time since the last source book update, not round-trip network latency. A synced book is this venue’s synchronized L2 view; it is not the entire crypto market.</p>
      <p>Gaps exceed three seconds between recorded snapshots. Book rebuilds restart persistence tracking. Sampled history can miss changes between snapshots, and zone ages are lower bounds from the available recording.</p>
      <p>{tradeCount.toLocaleString()} trades are available in this view; the oldest is {duration(tradeMs)} before the playhead. Trade history may be shorter than depth history. No trade observations are invented for missing history.</p>
      <p>Possible absorption uses closed 5s windows: ≥75% one-sided flow, ≥$50K and half the nearby resting size executed, with ≤0.75 price-bin net movement. Consumption and withdrawal compare snapshot reductions with recorded trades; neither proves individual order behavior.</p>
    </div>
  </details>
}

export function ReplayControls({ min, max, at, playing, speed, onAt, onPlay, onSpeed, onLive, onStep }: {
  min: number; max: number; at: number; playing: boolean; speed: number
  onAt: (at: number) => void; onPlay: () => void; onSpeed: (speed: number) => void; onLive: () => void; onStep: (direction: number) => void
}) {
  return <div className="shrink-0 space-y-2 border-b border-violet-400/20 bg-violet-400/[0.05] px-4 py-2.5 text-xs" data-testid="heatmap-replay">
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-2 flex items-center gap-1.5 font-medium text-violet-300" title="Recorded replay"><Radio size={13} /><span className="hidden sm:inline">Recorded replay</span></span>
      <button type="button" aria-label="Previous snapshot" onClick={() => onStep(-1)} className="rounded p-1.5 text-slate-400 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400"><SkipBack size={13} /></button>
      <button type="button" aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={onPlay} className="flex items-center gap-1.5 rounded border border-violet-400/25 px-2.5 py-1 text-violet-200 focus-visible:ring-2 focus-visible:ring-sky-400">{playing ? <Pause size={12} /> : <Play size={12} />}{playing ? 'Pause replay' : 'Play replay'}</button>
      <button type="button" aria-label="Next snapshot" onClick={() => onStep(1)} className="rounded p-1.5 text-slate-400 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400"><SkipForward size={13} /></button>
      <select aria-label="Replay speed" value={speed} onChange={e => onSpeed(Number(e.target.value))} className="rounded border border-white/10 bg-[#111c2c] px-2 py-1 text-slate-300">{[0.5, 1, 2, 4, 10].map(s => <option key={s} value={s}>{s}×</option>)}</select>
      <span className="font-mono text-[11px] text-violet-200" data-testid="replay-clock">{utc(at)} UTC</span>
      <button type="button" onClick={onLive} className="ml-auto hidden rounded px-2 py-1 text-sky-300 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-sky-400 sm:block">Return to live</button>
    </div>
    <label className="flex items-center gap-3 text-[10px] text-slate-500"><span className="font-mono">{utc(min)}</span><input type="range" aria-label="Replay playhead" min={min} max={Math.max(min + 1, max)} value={at} step="any" onChange={e => onAt(Number(e.target.value))} className="min-w-0 flex-1 accent-violet-400" /><span className="font-mono">{utc(max)}</span></label>
    <p className="hidden text-[10px] text-slate-500 sm:block">Only recorded data up to the playhead is shown. In-memory recording; refreshing or restarting can shorten available history.</p>
  </div>
}

export function ReactionFeed({ events, tick, onInspect }: { events: readonly HeatmapReaction[]; tick: number; onInspect: (time: number) => void }) {
  const recent = [...events].reverse().slice(0, 8)
  return <div data-testid="heatmap-reactions"><h2 className="mb-1 text-xs font-semibold text-slate-100">Observed reactions</h2><p className="mb-3 text-[10px] leading-relaxed text-slate-500">Snapshot-based observations, not trade predictions.</p>
    {recent.length === 0 ? <p className="rounded-lg border border-dashed border-white/10 p-3 text-[11px] text-slate-500">No qualifying reactions recorded yet.</p> : <div className="space-y-1.5">{recent.map(e => <details key={e.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <summary className="cursor-pointer list-none outline-none focus-visible:ring-2 focus-visible:ring-sky-400"><div className="flex items-center gap-2 text-[10px]"><span className="flex size-5 shrink-0 items-center justify-center rounded border font-mono" style={{ color: reactionColors[e.kind], borderColor: `${reactionColors[e.kind]}55` }}>{reactionCodes[e.kind]}</span><span className="min-w-0 flex-1" style={{ color: reactionColors[e.kind] }}>{reactionLabels[e.kind]}</span><time className="font-mono text-[9px] text-slate-500">{utc(e.t)}</time></div><div className="mt-1 pl-7 font-mono text-[10px] text-slate-400">{e.side} · {fmtPrice(e.price, tick)} · {fmtCompact(e.usd, '$')}</div></summary>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{e.note}</p><button type="button" onClick={() => onInspect(e.t)} className="mt-2 text-[10px] text-sky-300 hover:text-sky-100 focus-visible:ring-2 focus-visible:ring-sky-400">Inspect in replay →</button>
    </details>)}</div>}
  </div>
}
