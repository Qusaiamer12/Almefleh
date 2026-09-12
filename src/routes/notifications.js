'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/** تنبيهات المستخدم الحالي - هادئة، بتظهر على الجرس بس */
router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const { rows } = await db.query(
    `SELECT * FROM notifications WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [req.user.id, limit],
  );
  const { rows: counts } = await db.query(
    'SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [req.user.id],
  );
  res.json({ notifications: rows, unread: counts[0].unread });
}));

router.get('/count', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [req.user.id],
  );
  res.json({ unread: rows[0].unread });
}));

router.post('/:id/read', asyncHandler(async (req, res) => {
  await db.query(
    'UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
    [Number(req.params.id), req.user.id],
  );
  res.json({ ok: true });
}));

router.post('/read-all', asyncHandler(async (req, res) => {
  await db.query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id],
  );
  res.json({ ok: true });
}));

module.exports = router;
