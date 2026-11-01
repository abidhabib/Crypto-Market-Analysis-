/** UTC candle boundary. Exchange weeks start on Monday rather than epoch Thursday.
 * @param {number} time
 * @param {number} interval
 */
export function candleBucket(time, interval) {
  const offset = interval === 604800000 ? 345600000 : 0
  return Math.floor((time - offset) / interval) * interval + offset
}
