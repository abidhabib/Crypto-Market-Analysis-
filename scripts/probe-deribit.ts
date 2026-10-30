const res = await fetch('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option', { cache: 'no-store' })
const json = await res.json()
const rows = json.result || []
console.log('rows:', rows.length)
console.log('sample names:', rows.slice(0, 5).map((r: any) => r.instrument_name))
const re = /^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/
let ok = 0, bad: string[] = []
const expiries = new Set<number>()
const now = Date.now()
for (const r of rows) {
  const m = re.exec(r.instrument_name)
  if (!m) { bad.push(r.instrument_name); continue }
  ok++
  const months: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 }
  const exp = Date.UTC(2000 + +m[4], months[m[3]], +m[1], 8)
  if (exp > now) expiries.add(exp)
}
console.log('parsed ok:', ok, 'bad:', bad.slice(0, 5), 'live expiries:', expiries.size)
const sorted = [...expiries].sort((a, b) => a - b)
console.log('next expiries:', sorted.slice(0, 4).map((e) => new Date(e).toISOString()))
