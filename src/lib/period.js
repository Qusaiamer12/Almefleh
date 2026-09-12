'use strict';
/** تحديد فترة التقرير: أسبوع جاهز (يبلّش السبت) أو مدى مخصّص من-إلى */
const dates = require('./dates');

function resolvePeriod(query = {}) {
  if (query.from && query.to) {
    const range = dates.customRange(query.from, query.to);
    return { ...range, label: `من ${query.from} إلى ${query.to}`, type: 'custom' };
  }
  const offset = Number(query.week || 0);
  const range = dates.weekRangeOffset(Number.isFinite(offset) ? offset : 0);
  const lastDay = new Date(range.to.getTime() - 1);
  return {
    ...range,
    label: `أسبوع ${dates.toDateString(range.from)} → ${dates.toDateString(lastDay)}`,
    type: 'week',
    offset,
  };
}

/** هل الطلب فيه تحديد فترة أصلاً؟ */
function hasPeriod(query = {}) {
  return Boolean((query.from && query.to) || query.week !== undefined);
}

module.exports = { resolvePeriod, hasPeriod };
