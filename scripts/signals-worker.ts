import { runCycle } from '../src/lib/signals/service.ts'
import { repository } from '../src/lib/signals/repository.ts'

// Useful for a process supervisor or an authenticated operator's cron.
// The same database lease prevents overlap with Next's embedded worker.
try { await runCycle() } finally { await repository().close() }
