'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

export default function CryptoBubblesPanel() {
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  function reload() {
    setLoading(true)
    setFailed(false)
    setRevision((value) => value + 1)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111318]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-1.5 text-xs">
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Reload Crypto Bubbles"
        >
          <RefreshCw className="size-3" /> Reload
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {(loading || failed) && (
          <div role="status" className="pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto w-fit max-w-[90%] rounded border border-border bg-background/95 px-4 py-2 text-center text-xs text-muted-foreground">
            {failed ? 'Could not load Crypto Bubbles. Check your connection and press Reload.' : 'Loading Crypto Bubbles…'}
          </div>
        )}
        <iframe
          key={revision}
          src="https://cryptobubbles.net/en"
          title="Crypto Bubbles live interactive cryptocurrency market"
          className="h-full w-full border-0"
          allowFullScreen
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setFailed(true) }}
        />
      </div>
    </div>
  )
}
