export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build' && process.env.SIGNALS_ENABLED !== '0') {
    const { startSignalWorker } = await import('./lib/signals/service')
    startSignalWorker()
    const { startForecastWorker } = await import('./lib/forecasts/service')
    startForecastWorker()
  }
}
