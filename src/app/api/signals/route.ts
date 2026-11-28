import { dashboard } from '@/lib/signals/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams
  const days = Number(query.get('days') ?? '30'), page = Number(query.get('page') ?? '0'), grouping = query.get('group') ?? 'day'
  if (![1, 7, 30, 90, 365].includes(days) || !Number.isInteger(page) || page < 0 || page > 10000 || !['day', 'week', 'month'].includes(grouping)) {
    return Response.json({ error: 'Invalid history range or page' }, { status: 400 })
  }
  try {
    return Response.json(await dashboard(days, grouping as 'day' | 'week' | 'month', page), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[signals:read]', e instanceof Error ? e.message : 'Database unavailable')
    return Response.json({ error: 'Signal history is unavailable. Check the server database configuration.' }, { status: 503 })
  }
}
