'use strict';
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requireRole, canSeeMoney, redactTransaction } = require('../middleware/auth');
const { logAudit, diffFields } = require('../lib/audit');
const { notifyAll, notifyAdmins, TYPES } = require('../lib/notify');
const { parseQuantity, parseAmount, formatQuantity } = require('../lib/quantity');
const dates = require('../lib/dates');
const { resolvePeriod, hasPeriod } = require('../lib/period');

const router = express.Router();
router.use(requireAuth);

const GOODS_KINDS = ['supply', 'customer_out', 'customer_return', 'operator_out', 'operator_in'];
const ALL_KINDS = [...GOODS_KINDS, 'payment'];
const CUSTOMER_KINDS = ['customer_out', 'customer_return', 'payment'];
const OPERATOR_KINDS = ['operator_out', 'operator_in'];

const KIND_LABELS = {
  supply: 'توريد للمستودع',
  customer_out: 'سحب زبون',
  customer_return: 'إرجاع بضاعة',
  payment: 'دفعة',
  operator_out: 'إخراج للمشغل',
  operator_in: 'إدخال من المشغل',
};

/** التحقق من تطابق نوع الحركة مع الجهة، وتحضير القيم للحفظ */
async function buildTransactionPayload(body, user) {
  const kind = String(body?.kind || '');
  if (!ALL_KINDS.includes(kind)) {
    const e = new Error('نوع الحركة غير معروف'); e.status = 400; throw e;
  }

  let entity = null;
  if (kind !== 'supply') {
    const entityId = Number(body?.entity_id);
    const { rows } = await db.query('SELECT * FROM entities WHERE id = $1 AND active = TRUE', [entityId]);
    entity = rows[0];
    if (!entity) { const e = new Error('الجهة غير موجودة'); e.status = 400; throw e; }

    if (CUSTOMER_KINDS.includes(kind) && entity.type !== 'customer') {
      const e = new Error('هاي الحركة بتنسجّل على زبون مش على المشغل'); e.status = 400; throw e;
    }
    if (OPERATOR_KINDS.includes(kind) && entity.type !== 'operator') {
      const e = new Error('حركات المشغل بتنسجّل على المشغل بس'); e.status = 400; throw e;
    }
  }

  const payload = {
    kind,
    entity_id: entity ? entity.id : null,
    item_id: null,
    quantity: null,
    quantity_input: null,
    payment_amount: null,
    method: null,
    note: body?.note ? String(body.note).trim() : null,
    unit_price_override: null,
  };

  if (kind === 'payment') {
    payload.payment_amount = parseAmount(body?.payment_amount ?? body?.amount);
    const method = String(body?.method || '');
    if (!['cash', 'bank', 'check'].includes(method)) {
      const e = new Error('لازم تحدد طريقة الدفع: نقدي / تحويل بنكي / شيك'); e.status = 400; throw e;
    }
    payload.method = method;
  } else {
    const itemId = Number(body?.item_id);
    const { rows } = await db.query('SELECT * FROM items WHERE id = $1', [itemId]);
    const item = rows[0];
    if (!item) { const e = new Error('الصنف غير موجود'); e.status = 400; throw e; }
    const parsed = parseQuantity(body?.quantity, item.unit);
    payload.item_id = item.id;
    payload.quantity = parsed.value;
    payload.quantity_input = parsed.raw;

    // سعر استثنائي للحركة - للأدمن بس
    if (user.role === 'admin' && body?.unit_price_override != null && body.unit_price_override !== '') {
      const override = Number(body.unit_price_override);
      if (!(override >= 0)) { const e = new Error('سعر استثنائي غير صالح'); e.status = 400; throw e; }
      payload.unit_price_override = override;
    }
  }

  return payload;
}

/** فحص الستوك بعد الحركة + تنبيه إذا صار سالب */
async function checkStock(client, itemId, user) {
  if (!itemId) return null;
  const { rows } = await client.query(
    'SELECT item_name, unit, quantity FROM v_stock WHERE item_id = $1', [itemId],
  );
  const row = rows[0];
  if (!row || Number(row.quantity) >= 0) return null;

  const qty = Number(row.quantity);
  return {
    level: 'danger',
    // المسجّل (عبود) ما بيشوف أرقام الستوك - بس بينتبّه إنه في نقص
    message: canSeeMoney(user)
      ? `تنبيه: رصيد "${row.item_name}" صار بالسالب (${formatQuantity(qty, row.unit)})`
      : `تنبيه: الكمية المسحوبة أكتر من المتوفر بالمستودع لصنف "${row.item_name}"`,
    item_id: itemId,
    item_name: row.item_name,
    quantity: canSeeMoney(user) ? qty : undefined,
  };
}

/** عرض الحركات مع فلاتر */
router.get('/', asyncHandler(async (req, res) => {
  const where = ['TRUE'];
  const params = [];

  // الزبون بيشوف حركاته هو بس
  if (req.user.role === 'customer') {
    params.push(req.user.entity_id);
    where.push(`v.entity_id = $${params.length}`);
  } else if (req.query.entity_id) {
    params.push(Number(req.query.entity_id));
    where.push(`v.entity_id = $${params.length}`);
  }

  if (req.query.item_id) { params.push(Number(req.query.item_id)); where.push(`v.item_id = $${params.length}`); }
  if (req.query.kind && ALL_KINDS.includes(req.query.kind)) {
    params.push(req.query.kind); where.push(`v.kind = $${params.length}`);
  }
  if (hasPeriod(req.query)) {
    const period = resolvePeriod(req.query);
    params.push(period.from); where.push(`v.occurred_at >= $${params.length}`);
    params.push(period.to);   where.push(`v.occurred_at < $${params.length}`);
  }
  if (String(req.query.pending_price || '') === 'true') where.push('v.price_pending');
  // "حركاتي أنا" - بتستعملها شاشة التسجيل عشان تعرض اللي سجّله المستخدم بس
  if (String(req.query.mine || '') === 'true') {
    params.push(req.user.id);
    where.push(`v.created_by = $${params.length}`);
  }

  const limit = Math.min(Number(req.query.limit || 200), 1000);
  params.push(limit);

  const { rows } = await db.query(
    `SELECT v.*, u.display_name AS created_by_name, u2.display_name AS updated_by_name
     FROM v_transactions v
     LEFT JOIN users u  ON u.id = v.created_by
     LEFT JOIN users u2 ON u2.id = v.updated_by
     WHERE ${where.join(' AND ')}
     ORDER BY v.occurred_at DESC, v.id DESC
     LIMIT $${params.length}`,
    params,
  );

  res.json({
    transactions: rows.map((t) => redactTransaction({ ...t, kind_label: KIND_LABELS[t.kind] }, req.user)),
  });
}));

/** تسجيل حركة جديدة */
router.post('/', requireRole('admin', 'recorder'), asyncHandler(async (req, res) => {
  const payload = await buildTransactionPayload(req.body, req.user);

  // الوقت تلقائي؛ الأدمن بس بيقدر يحدّد تاريخ يدوي (لتصحيح حركة قديمة)
  let occurredAt = new Date();
  if (req.user.role === 'admin' && req.body?.occurred_at) {
    occurredAt = new Date(req.body.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) return res.status(400).json({ error: 'تاريخ غير صالح' });
  }

  const result = await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO transactions
         (kind, entity_id, item_id, quantity, quantity_input, unit_price_override,
          payment_amount, method, note, occurred_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [payload.kind, payload.entity_id, payload.item_id, payload.quantity, payload.quantity_input,
       payload.unit_price_override, payload.payment_amount, payload.method, payload.note,
       occurredAt, req.user.id],
    );
    const txn = rows[0];

    const { rows: view } = await client.query('SELECT * FROM v_transactions WHERE id = $1', [txn.id]);
    const full = view[0];

    await logAudit(client, {
      user: req.user, action: 'create', table: 'transactions', recordId: txn.id,
      after: txn,
      summary: `${KIND_LABELS[txn.kind]}${full.entity_name ? ' - ' + full.entity_name : ''}` +
               `${full.item_name ? ' - ' + full.item_name + ' × ' + txn.quantity_input : ''}` +
               `${txn.payment_amount ? ' - ' + txn.payment_amount : ''}`,
      ip: req.ip,
    });

    const warning = await checkStock(client, txn.item_id, req.user);
    if (warning) {
      await notifyAll(client, {
        type: TYPES.NEGATIVE_STOCK,
        title: 'رصيد صنف تحت الصفر',
        body: `"${warning.item_name}" صار رصيده سالب بعد آخر حركة`,
        data: { item_id: warning.item_id },
      });
    }

    // حركة زبون بصنف بدون سعر => المبلغ معلّق
    if (full.price_pending) {
      await notifyAdmins(client, {
        type: TYPES.PENDING_PRICE,
        title: 'حركة بسعر معلّق',
        body: `"${full.item_name}" ما إله سعر - حركة ${full.entity_name} ما بتنحسب لحد ما تحدّد السعر`,
        data: { transaction_id: txn.id, item_id: txn.item_id },
      });
    }

    return { full, warning };
  });

  res.status(201).json({
    transaction: redactTransaction({ ...result.full, kind_label: KIND_LABELS[result.full.kind] }, req.user),
    warnings: result.warning ? [result.warning] : [],
  });
}));

/** تعديل حركة - بيعيد حساب كل التوتالات تلقائياً */
router.patch('/:id', requireRole('admin', 'recorder'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: existing } = await db.query(
    'SELECT * FROM transactions WHERE id = $1 AND deleted_at IS NULL', [id],
  );
  const before = existing[0];
  if (!before) return res.status(404).json({ error: 'الحركة غير موجودة' });

  // دمج القيم الجديدة فوق القديمة
  const merged = {
    kind: req.body?.kind ?? before.kind,
    entity_id: req.body?.entity_id !== undefined ? req.body.entity_id : before.entity_id,
    item_id: req.body?.item_id !== undefined ? req.body.item_id : before.item_id,
    quantity: req.body?.quantity !== undefined ? req.body.quantity : before.quantity_input || before.quantity,
    payment_amount: req.body?.payment_amount !== undefined ? req.body.payment_amount : before.payment_amount,
    method: req.body?.method ?? before.method,
    note: req.body?.note !== undefined ? req.body.note : before.note,
    unit_price_override: req.body?.unit_price_override !== undefined
      ? req.body.unit_price_override : before.unit_price_override,
  };
  const payload = await buildTransactionPayload(merged, req.user);

  let occurredAt = before.occurred_at;
  if (req.user.role === 'admin' && req.body?.occurred_at) {
    occurredAt = new Date(req.body.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) return res.status(400).json({ error: 'تاريخ غير صالح' });
  }

  const result = await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE transactions SET kind=$1, entity_id=$2, item_id=$3, quantity=$4, quantity_input=$5,
              unit_price_override=$6, payment_amount=$7, method=$8, note=$9, occurred_at=$10,
              updated_by=$11, updated_at=now()
       WHERE id=$12 RETURNING *`,
      [payload.kind, payload.entity_id, payload.item_id, payload.quantity, payload.quantity_input,
       payload.unit_price_override, payload.payment_amount, payload.method, payload.note,
       occurredAt, req.user.id, id],
    );
    const after = rows[0];

    await logAudit(client, {
      user: req.user, action: 'update', table: 'transactions', recordId: id,
      before, after, summary: `تعديل حركة #${id} (${KIND_LABELS[before.kind]})`, ip: req.ip,
    });

    await notifyAdmins(client, {
      type: TYPES.TXN_EDITED,
      title: 'تعديل حركة',
      body: `${req.user.display_name} عدّل الحركة #${id}`,
      data: { transaction_id: id },
    });

    const warning = await checkStock(client, after.item_id, req.user);
    const { rows: view } = await client.query('SELECT * FROM v_transactions WHERE id = $1', [id]);
    return { after: view[0], warning, changes: diffFields(before, after) };
  });

  res.json({
    transaction: redactTransaction({ ...result.after, kind_label: KIND_LABELS[result.after.kind] }, req.user),
    changes: result.changes,
    warnings: result.warning ? [result.warning] : [],
  });
}));

/** حذف حركة (حذف ناعم) - التوتالات بترجع تلقائياً */
router.delete('/:id', requireRole('admin', 'recorder'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: existing } = await db.query(
    'SELECT * FROM v_transactions WHERE id = $1', [id],
  );
  const before = existing[0];
  if (!before) return res.status(404).json({ error: 'الحركة غير موجودة' });

  await db.withTransaction(async (client) => {
    await client.query(
      'UPDATE transactions SET deleted_at = now(), deleted_by = $1 WHERE id = $2', [req.user.id, id],
    );
    await logAudit(client, {
      user: req.user, action: 'delete', table: 'transactions', recordId: id,
      before,
      summary: `حذف حركة #${id} (${KIND_LABELS[before.kind]}` +
               `${before.entity_name ? ' - ' + before.entity_name : ''}` +
               `${before.amount ? ' - ' + before.amount : ''})`,
      ip: req.ip,
    });
    await notifyAdmins(client, {
      type: TYPES.TXN_EDITED,
      title: 'حذف حركة',
      body: `${req.user.display_name} حذف الحركة #${id}`,
      data: { transaction_id: id },
    });
  });

  res.json({ ok: true });
}));

/** الأنواع والتسميات - للواجهة */
router.get('/meta/kinds', (_req, res) => {
  res.json({
    kinds: ALL_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })),
    methods: [
      { value: 'cash', label: 'نقدي' },
      { value: 'bank', label: 'تحويل بنكي' },
      { value: 'check', label: 'شيك' },
    ],
    week_start: dates.DOW_NAMES[dates.WEEK_START_DOW],
  });
});

module.exports = { router, KIND_LABELS };
