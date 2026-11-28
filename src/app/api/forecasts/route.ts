import { forecastDashboard } from '@/lib/forecasts/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams
  const market = q.get('market') ?? 'spot', days = Number(q.get('days') ?? 30), page = Number(q.get('page') ?? 0)
  if (!['spot', 'futures'].includes(market) || ![1, 7, 30, 90, 365].includes(days) || !Number.isInteger(page) || page < 0 || page > 10000) {
    return Response.json({ error: 'Invalid market, history range or page' }, { status: 400 })
  }
  try {
    return Response.json(await forecastDashboard(market as 'spot' | 'futures', days, page), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[forecasts:read]', e instanceof Error ? e.message : 'Database unavailable')
    return Response.json({ error: 'Forecast history is unavailable. Check the server database configuration.' }, { status: 503 })
  }
}
