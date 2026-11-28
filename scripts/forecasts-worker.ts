import { runForecastCycle } from '../src/lib/forecasts/service.ts'
import { repository } from '../src/lib/signals/repository.ts'

// Explicit operator invocation runs one cycle even when the embedded worker is disabled.
try { await runForecastCycle() } finally { await repository().close() }
