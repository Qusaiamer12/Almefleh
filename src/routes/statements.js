'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { parseId } = require('../lib/validate');
const { requireAuth } = require('../middleware/auth');
const { resolvePeriod } = require('../lib/period');
const { KIND_LABELS } = require('./transactions');

const router = express.Router();
router.use(requireAuth);

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
    // تحويل مباشر كان بيضيّع معاملات الفترة (?week=-1 وغيرها)،
    // فبنبني الرابط من جديد مع نفس المعاملات.
    const query = new URLSearchParams(req.query).toString();
    return res.redirect(`/api/statements/${req.user.entity_id}${query ? '?' + query : ''}`);
  }
  if (req.user.role === 'recorder') {
    return res.status(403).json({ error: 'ما عندك صلاحية تشوف الأرصدة' });
  }

  const period = resolvePeriod(req.query);
  const { rows } = await db.query(
    `SELECT b.*,
            ROUND(COALESCE((SELECT SUM(v.debt_delta) FROM v_transactions v
                      WHERE v.entity_id = b.entity_id AND v.occurred_at < $1), 0), 2) AS opening_balance,
            ROUND(COALESCE((SELECT SUM(v.debt_delta) FROM v_transactions v
                      WHERE v.entity_id = b.entity_id
                        AND v.occurred_at >= $1 AND v.occurred_at < $2), 0), 2) AS period_change
     FROM v_balances b
     WHERE b.type = 'customer'
     ORDER BY b.entity_name`,
    [period.from, period.to],
  );
  // التوتالات بتنحسب بـ NUMERIC داخل القاعدة، مش بجمع أرقام JS عشرية
  const { rows: totals } = await db.query('SELECT * FROM v_customer_totals');

  res.json({
    period,
    customers: rows,
    totals: {
      balance: totals[0].total_balance,
      total_withdrawn: totals[0].total_withdrawn,
      total_paid: totals[0].total_paid,
    },
  });
}));

/** كشف حساب جهة لفترة (أسبوعي افتراضياً، أو أي فترة مخصّصة) */
router.get('/:entityId', asyncHandler(async (req, res) => {
  const entityId = parseId(req.params.entityId, 'رقم الجهة');
  assertAccess(req.user, entityId);

  const { rows: entityRows } = await db.query('SELECT * FROM entities WHERE id = $1', [entityId]);
  const entity = entityRows[0];
  if (!entity) return res.status(404).json({ error: 'الجهة غير موجودة' });

  const period = resolvePeriod(req.query);

  // كل الأرقام المالية بتنحسب بـ NUMERIC جوّا القاعدة (دقّة تامة، بدون فروقات تراكمية)
  const { rows: summaryRows } = await db.query(
    'SELECT * FROM entity_period_summary($1, $2, $3)',
    [entityId, period.from, period.to],
  );
  const summary = summaryRows[0];

  // الرصيد الجاري سطر بسطر بدالة نافذة - كمان بـ NUMERIC
  const { rows: lines } = await db.query(
    `SELECT v.*, u.display_name AS created_by_name,
            ROUND($4::numeric + SUM(v.debt_delta) OVER (
              ORDER BY v.occurred_at, v.id ROWS UNBOUNDED PRECEDING
            ), 2) AS running_balance
     FROM v_transactions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.entity_id = $1 AND v.occurred_at >= $2 AND v.occurred_at < $3
     ORDER BY v.occurred_at, v.id`,
    [entityId, period.from, period.to, summary.opening_balance],
  );

  res.json({
    entity,
    period,
    opening_balance: summary.opening_balance,
    lines: lines.map((l) => ({ ...l, kind_label: KIND_LABELS[l.kind] })),
    totals: {
      withdrawals: summary.withdrawals,
      returns: summary.returns,
      payments: summary.payments,
      pending_price_lines: summary.pending_lines,
    },
    closing_balance: summary.closing_balance,
    financial: entity.has_financials,
  });
}));

module.exports = router;
