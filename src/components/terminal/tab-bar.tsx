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
        className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 bg-[#0d1017] px-2"
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
                  'shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs transition-colors',
                  tab === t.id
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
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
