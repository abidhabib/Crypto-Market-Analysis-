'use client'

import { TABS, type TabId } from '@/lib/terminal/constants'
import { useTerminal } from '@/lib/terminal/store'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export default function TabBar() {
  const { tab, setTab } = useTerminal()
  return (
    <TooltipProvider delayDuration={250}>
      <nav
        role="tablist"
        aria-label="Terminal panels"
        className="flex min-h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-neutral-700/70 bg-[#151515] px-2 py-1.5 shadow-[inset_0_1px_0_#ffffff06]"
      >
        {TABS.map((t) => (
          <Tooltip key={t.id}>
            <TooltipTrigger asChild>
              <button
                role="tab"
                aria-selected={tab === t.id}
                title={t.hint}
                onClick={() => setTab(t.id as TabId)}
                className={cn(
                  'min-h-9 shrink-0 whitespace-nowrap rounded-md border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400',
                  tab === t.id
                    ? 'border-white/10 bg-[#292929] text-white shadow-[inset_0_-2px_0_#f0b90b]'
                    : 'border-neutral-700/60 bg-[#1c1c1c] text-neutral-400 hover:border-neutral-500 hover:bg-[#242424] hover:text-neutral-100',
                )}
              >
                {t.label}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[10px]">
              {t.hint}
            </TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label="Open guide"
              onClick={() => setTab('guide')}
              className="ml-1.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              ?
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[10px]">Shortcuts & methodology (G)</TooltipContent>
        </Tooltip>
      </nav>
    </TooltipProvider>
  )
}
