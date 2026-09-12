'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth } = require('../middleware/auth');
const dates = require('../lib/dates');
const { KIND_LABELS } = require('./transactions');

const router = express.Router();
router.use(requireAuth);

/** تحديد الفترة: أسبوع جاهز (يبلّش السبت) أو مدى مخصّص */
function resolvePeriod(query) {
  if (query.from && query.to) {
    const range = dates.customRange(query.from, query.to);
    return { ...range, label: `من ${query.from} إلى ${query.to}`, type: 'custom' };
  }
  const offset = Number(query.week || 0);
  const range = dates.weekRangeOffset(offset);
  const endDay = new Date(range.to.getTime() - 1);
  return {
    ...range,
    label: `أسبوع ${dates.toDateString(range.from)} → ${dates.toDateString(endDay)}`,
    type: 'week',
    offset,
  };
}

/** منع الزبون من رؤية غير حسابه */
function assertAccess(user, entityId) {
  if (user.role === 'recorder') {
    const e = new Error('ما عندك صلاحية تشوف الكشوفات'); e.status = 403; throw e;
  }
  if (user.role === 'customer' && Number(user.entity_id) !== Number(entityId)) {
    const e = new Error('بتقدر تشوف كشف حسابك بس'); e.status = 403; throw e;
  }
}

/** ملخّص أرصدة كل الزباين */
router.get('/', asyncHandler(async (req, res) => {
  if (req.user.role === 'customer') {
    return res.redirect(`/api/statements/${req.user.entity_id}`);
  }
  if (req.user.role === 'recorder') {
    return res.status(403).json({ error: 'ما عندك صلاحية تشوف الأرصدة' });
  }

  const period = resolvePeriod(req.query);
  const { rows } = await db.query(
    `SELECT b.*,
            COALESCE((SELECT SUM(v.debt_delta) FROM v_transactions v
                      WHERE v.entity_id = b.entity_id AND v.occurred_at < $1), 0) AS opening_balance,
            COALESCE((SELECT SUM(v.debt_delta) FROM v_transactions v
                      WHERE v.entity_id = b.entity_id
                        AND v.occurred_at >= $1 AND v.occurred_at < $2), 0) AS period_change
     FROM v_balances b
     WHERE b.type = 'customer'
     ORDER BY b.entity_name`,
    [period.from, period.to],
  );

  res.json({
    period,
    customers: rows,
    totals: {
      balance: Number(rows.reduce((s, r) => s + Number(r.balance), 0).toFixed(2)),
      total_withdrawn: Number(rows.reduce((s, r) => s + Number(r.total_withdrawn), 0).toFixed(2)),
      total_paid: Number(rows.reduce((s, r) => s + Number(r.total_paid), 0).toFixed(2)),
    },
  });
}));

/** كشف حساب جهة لفترة (أسبوعي افتراضياً، أو أي فترة مخصّصة) */
router.get('/:entityId', asyncHandler(async (req, res) => {
  const entityId = Number(req.params.entityId);
  assertAccess(req.user, entityId);

  const { rows: entityRows } = await db.query('SELECT * FROM entities WHERE id = $1', [entityId]);
  const entity = entityRows[0];
  if (!entity) return res.status(404).json({ error: 'الجهة غير موجودة' });

  const period = resolvePeriod(req.query);

  const { rows: openingRows } = await db.query(
    `SELECT COALESCE(SUM(debt_delta), 0) AS opening
     FROM v_transactions WHERE entity_id = $1 AND occurred_at < $2`,
    [entityId, period.from],
  );
  const opening = Number(openingRows[0].opening);

  const { rows: lines } = await db.query(
    `SELECT v.*, u.display_name AS created_by_name
     FROM v_transactions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.entity_id = $1 AND v.occurred_at >= $2 AND v.occurred_at < $3
     ORDER BY v.occurred_at, v.id`,
    [entityId, period.from, period.to],
  );

  // رصيد جاري سطر بسطر
  let running = opening;
  const rows = lines.map((l) => {
    running = Number((running + Number(l.debt_delta || 0)).toFixed(2));
    return { ...l, kind_label: KIND_LABELS[l.kind], running_balance: running };
  });

  const totals = {
    withdrawals: sum(rows, (r) => (r.kind === 'customer_out' ? Number(r.amount || 0) : 0)),
    returns: sum(rows, (r) => (r.kind === 'customer_return' ? Number(r.amount || 0) : 0)),
    payments: sum(rows, (r) => (r.kind === 'payment' ? Number(r.payment_amount || 0) : 0)),
    pending_price_lines: rows.filter((r) => r.price_pending).length,
  };

  res.json({
    entity,
    period,
    opening_balance: Number(opening.toFixed(2)),
    lines: rows,
    totals,
    closing_balance: Number(running.toFixed(2)),
    financial: entity.has_financials,
  });
}));

function sum(rows, pick) {
  return Number(rows.reduce((s, r) => s + pick(r), 0).toFixed(2));
}

module.exports = router;
