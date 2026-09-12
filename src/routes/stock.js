'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { bomCost } = require('../lib/pricing');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'viewer'));

/** تقرير الستوك اللحظي */
router.get('/', asyncHandler(async (req, res) => {
  const includeInactive = String(req.query.include_inactive || '') === 'true';
  const { rows } = await db.query(
    `SELECT s.*, 
            EXISTS (SELECT 1 FROM item_components ic WHERE ic.parent_item_id = s.item_id) AS has_recipe
     FROM v_stock s
     ${includeInactive ? '' : 'WHERE s.active = TRUE'}
     ORDER BY s.item_name`,
  );

  const items = rows.map((r) => ({
    ...r,
    negative: Number(r.quantity) < 0,
    needs_price: r.current_price == null,
    value: r.current_price == null ? null : Number((Number(r.quantity) * Number(r.current_price)).toFixed(2)),
  }));

  res.json({
    items,
    summary: {
      total_items: items.length,
      negative_count: items.filter((i) => i.negative).length,
      missing_price_count: items.filter((i) => i.needs_price).length,
      total_value: Number(items.reduce((sum, i) => sum + (i.value || 0), 0).toFixed(2)),
    },
  });
}));

/** تفاصيل صنف واحد: رصيد + سعر + مقادير + آخر الحركات */
router.get('/:itemId', asyncHandler(async (req, res) => {
  const itemId = Number(req.params.itemId);
  const { rows } = await db.query('SELECT * FROM v_stock WHERE item_id = $1', [itemId]);
  if (!rows[0]) return res.status(404).json({ error: 'الصنف غير موجود' });

  const { rows: moves } = await db.query(
    `SELECT v.*, u.display_name AS created_by_name FROM v_transactions v
     LEFT JOIN users u ON u.id = v.created_by
     WHERE v.item_id = $1 ORDER BY v.occurred_at DESC LIMIT 50`,
    [itemId],
  );
  const cost = await bomCost(db, itemId, new Date());

  res.json({ item: rows[0], movements: moves, cost: cost.cost, cost_lines: cost.lines });
}));

module.exports = router;
