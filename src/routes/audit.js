'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
// سجل التدقيق: قصي (الأدمن) بس
router.use(requireAuth, requireRole('admin'));

const ACTION_LABELS = {
  create: 'إضافة', update: 'تعديل', delete: 'حذف', login: 'دخول',
};
const TABLE_LABELS = {
  transactions: 'حركة', items: 'صنف', item_prices: 'سعر',
  item_components: 'مقادير', users: 'حساب', customer_requests: 'طلب زبون',
  price_proposals: 'اقتراح سعر',
};

router.get('/', asyncHandler(async (req, res) => {
  const where = ['TRUE'];
  const params = [];
  if (req.query.table) { params.push(req.query.table); where.push(`a.table_name = $${params.length}`); }
  if (req.query.action) { params.push(req.query.action); where.push(`a.action = $${params.length}`); }
  if (req.query.user_id) { params.push(Number(req.query.user_id)); where.push(`a.user_id = $${params.length}`); }
  if (req.query.from) { params.push(new Date(req.query.from)); where.push(`a.created_at >= $${params.length}`); }
  if (req.query.to) { params.push(new Date(req.query.to)); where.push(`a.created_at < $${params.length}`); }
  if (String(req.query.hide_logins || 'true') === 'true') where.push("a.action <> 'login'");

  const limit = Math.min(Number(req.query.limit || 200), 1000);
  params.push(limit);

  const { rows } = await db.query(
    `SELECT a.*, u.display_name AS user_display_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.created_at DESC, a.id DESC LIMIT $${params.length}`,
    params,
  );

  res.json({
    entries: rows.map((r) => ({
      ...r,
      action_label: ACTION_LABELS[r.action] || r.action,
      table_label: TABLE_LABELS[r.table_name] || r.table_name,
    })),
  });
}));

module.exports = router;
