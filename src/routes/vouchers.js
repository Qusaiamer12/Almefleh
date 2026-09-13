'use strict';
/**
 * السندات: سند واحد فيه أكتر من صنف.
 *
 * الواقع: عبود بيجهّز طلب زبون فيه ٨ أصناف. تسجيلها حركة حركة يعني ٨ فرص غلط
 * وما في مراجعة قبل التثبيت. السند بيجمّعهم: بيبني الأسطر، بيعرض الجرد الكلي،
 * وبيثبّت - والأسطر بتنحفظ كلها أو ولا وحدة (لا نص سند).
 *
 * كل سطر بيضل حركة عادية بجدول transactions، فالأرصدة والستوك والكشوفات
 * ما بتتغيّر ولا بتحتاج منطق جديد. السند بس بيجمّعهم ويعطيهم رقم.
 *
 * الدفعات (فلوس) ما إلها سندات - شغل مالي بيتسجّل من حساب المدير حركة حركة.
 */
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../middleware/errors');
const { requireAuth, requireRole, canSeeMoney, redactTransaction } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { notifyAll, notifyAdmins, TYPES } = require('../lib/notify');
const { validate, parseId } = require('../lib/validate');
const { resolvePeriod, hasPeriod } = require('../lib/period');
const {
  KIND_LABELS, GOODS_KINDS, buildTransactionPayload, checkStock,
} = require('./transactions');

const router = express.Router();
router.use(requireAuth);

/** سند بـ ٥٠ سطر أكبر من أي طلب حقيقي - الحد بيحمي من طلب مفخّخ */
const MAX_LINES = 50;

const VOUCHER_SCHEMA = {
  kind: { type: 'enum', values: GOODS_KINDS, required: true, label: 'نوع السند' },
  entity_id: { type: 'int', min: 1, label: 'الجهة' },
  note: { type: 'string', maxLength: 500, label: 'ملاحظة السند' },
  occurred_at: { type: 'date', maxFutureDays: 1, label: 'تاريخ السند' },
  client_token: { type: 'string', minLength: 8, maxLength: 64,
                  pattern: /^[A-Za-z0-9._-]+$/, label: 'رمز الطلب' },
};

const LINE_SCHEMA = {
  item_id: { type: 'int', min: 1, required: true, label: 'الصنف' },
  quantity: { type: 'string', maxLength: 40, required: true, label: 'الكمية' },
  note: { type: 'string', maxLength: 500, label: 'ملاحظة السطر' },
  unit_price_override: { type: 'number', min: 0, max: 1e9, label: 'السعر الاستثنائي' },
};

const badRequest = (message, status = 400) => {
  const e = new Error(message); e.status = status; return e;
};

/** المسجّل (عبود) ما بيشوف أرقام مالية - لا بالحركة ولا بملخّص السند */
function redactVoucher(voucher, user) {
  if (canSeeMoney(user)) return voucher;
  const { total_amount, pending_price_lines, ...rest } = voucher;
  return rest;
}

const withLabel = (voucher) => ({ ...voucher, kind_label: KIND_LABELS[voucher.kind] });

/** عدّ عربي صحيح بالسجلّات والتنبيهات: "صنف واحد" / "صنفين" / "٣ أصناف" */
function countItems(n) {
  if (n === 1) return 'صنف واحد';
  if (n === 2) return 'صنفين';
  return n >= 3 && n <= 10 ? `${n} أصناف` : `${n} صنف`;
}

/** السند كامل مع أسطره - نفس الشكل اللي بترجّعه كل المسارات */
async function loadVoucher(client, id, user) {
  const { rows } = await client.query('SELECT * FROM v_vouchers WHERE id = $1', [id]);
  const voucher = rows[0];
  if (!voucher) throw badRequest('السند غير موجود', 404);

  const { rows: lines } = await client.query(
    `SELECT v.*, u.display_name AS created_by_name
     FROM v_transactions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.voucher_id = $1 ORDER BY v.id`,
    [id],
  );
  return {
    voucher: redactVoucher(withLabel(voucher), user),
    lines: lines.map((t) => redactTransaction({ ...t, kind_label: KIND_LABELS[t.kind] }, user)),
  };
}

/** قائمة السندات */
router.get('/', asyncHandler(async (req, res) => {
  const where = ['TRUE'];
  const params = [];

  // الزبون بيشوف سنداته هو بس
  if (req.user.role === 'customer') {
    params.push(req.user.entity_id);
    where.push(`v.entity_id = $${params.length}`);
  } else if (req.query.entity_id) {
    params.push(Number(req.query.entity_id));
    where.push(`v.entity_id = $${params.length}`);
  }

  if (req.query.kind && GOODS_KINDS.includes(req.query.kind)) {
    params.push(req.query.kind); where.push(`v.kind = $${params.length}`);
  }
  if (hasPeriod(req.query)) {
    const period = resolvePeriod(req.query);
    params.push(period.from); where.push(`v.occurred_at >= $${params.length}`);
    params.push(period.to);   where.push(`v.occurred_at < $${params.length}`);
  }
  // "سنداتي أنا" - بتستعملها شاشة التسجيل
  if (String(req.query.mine || '') === 'true') {
    params.push(req.user.id);
    where.push(`v.created_by = $${params.length}`);
  }

  const limit = Math.min(Number(req.query.limit || 100), 500);
  params.push(limit);

  const { rows } = await db.query(
    `SELECT v.* FROM v_vouchers v
     WHERE ${where.join(' AND ')}
     ORDER BY v.occurred_at DESC, v.id DESC
     LIMIT $${params.length}`,
    params,
  );
  res.json({ vouchers: rows.map((v) => redactVoucher(withLabel(v), req.user)) });
}));

/** سند واحد مع أسطره */
router.get('/:id', asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'رقم السند');
  const result = await loadVoucher(db, id, req.user);
  if (req.user.role === 'customer' && result.voucher.entity_id !== req.user.entity_id) {
    throw badRequest('بتقدر تشوف سنداتك بس', 403);
  }
  res.json(result);
}));

/**
 * تثبيت سند: السند وكل أسطره بعملية وحدة.
 * إذا وقع سطر واحد، ما بينحفظ ولا سطر - عشان ما يصير نص سند بالمستودع.
 */
router.post('/', requireRole('admin', 'recorder'), asyncHandler(async (req, res) => {
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    throw badRequest('البيانات المرسلة غير صالحة');
  }
  const { lines: rawLines, ...head } = req.body;
  const input = validate(head, VOUCHER_SCHEMA);

  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw badRequest('السند لازم يكون فيه صنف واحد على الأقل');
  }
  if (rawLines.length > MAX_LINES) {
    throw badRequest(`السند الواحد بياخد ${MAX_LINES} صنف كحد أقصى - قسّمه لسندين`);
  }
  if (input.kind !== 'supply' && !input.entity_id) {
    throw badRequest('لازم تحدد الجهة (زبون أو مشغل) قبل تثبيت السند');
  }
  const lines = rawLines.map((line) => {
    if (line === null || typeof line !== 'object' || Array.isArray(line)) {
      throw badRequest('سطر غير صالح بالسند');
    }
    return validate(line, LINE_SCHEMA);
  });

  // الوقت تلقائي؛ الأدمن بس بيقدر يحدّد تاريخ يدوي (لتصحيح سند قديم)
  const occurredAt = (req.user.role === 'admin' && input.occurred_at) ? input.occurred_at : new Date();

  // الطلب المكرّر بنفس الرمز بيرجّع السند الأصلي بدل ما يثبّت سند تاني
  if (input.client_token) {
    const existing = await findByToken(input.client_token, req.user);
    if (existing) return res.status(200).json({ ...existing, warnings: [], duplicate: true });
  }

  const result = await db.withTransaction(async (client) => {
    const { rows: created } = await client.query(
      `INSERT INTO vouchers (kind, entity_id, note, occurred_at, created_by, client_token)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.kind, input.kind === 'supply' ? null : (input.entity_id ?? null),
       input.note || null, occurredAt, req.user.id, input.client_token || null],
    );
    const voucher = created[0];

    const saved = [];
    for (const line of lines) {
      // نفس تحقّق الحركة المفردة: الجهة والصنف والكمية - بلا منطق موازي
      const payload = await buildTransactionPayload(
        client, { ...line, kind: input.kind, entity_id: input.entity_id }, req.user,
      );
      const { rows } = await client.query(
        `INSERT INTO transactions
           (kind, entity_id, item_id, quantity, quantity_input, unit_price_override,
            note, occurred_at, created_by, voucher_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [payload.kind, payload.entity_id, payload.item_id, payload.quantity, payload.quantity_input,
         payload.unit_price_override, payload.note, occurredAt, req.user.id, voucher.id],
      );
      saved.push(rows[0]);
    }

    const { rows: view } = await client.query(
      `SELECT * FROM v_transactions WHERE voucher_id = $1 ORDER BY id`, [voucher.id],
    );

    const { rows: summary } = await client.query('SELECT * FROM v_vouchers WHERE id = $1', [voucher.id]);
    const totals = summary[0];

    await logAudit(client, {
      user: req.user, action: 'create', table: 'vouchers', recordId: voucher.id,
      after: { ...voucher, lines: saved },
      summary: `سند #${voucher.voucher_no} - ${KIND_LABELS[voucher.kind]}` +
               `${totals.entity_name ? ' - ' + totals.entity_name : ''} - ${countItems(saved.length)}`,
      ip: req.ip,
    });
    // وكمان كل سطر لحاله: هيك التدقيق على الحركة بيضل كامل زي الحركة المفردة
    for (const txn of saved) {
      const full = view.find((v) => v.id === txn.id);
      await logAudit(client, {
        user: req.user, action: 'create', table: 'transactions', recordId: txn.id,
        after: txn,
        summary: `سند #${voucher.voucher_no}: ${KIND_LABELS[txn.kind]}` +
                 `${totals.entity_name ? ' - ' + totals.entity_name : ''}` +
                 ` - ${full?.item_name} × ${txn.quantity_input}`,
        ip: req.ip,
      });
    }

    // تنبيه الستوك السالب: مرّة لكل صنف مهما تكرّر بالسند
    const warnings = [];
    for (const itemId of [...new Set(saved.map((t) => t.item_id))]) {
      const warning = await checkStock(client, itemId, req.user);
      if (!warning) continue;
      warnings.push(warning);
      await notifyAll(client, {
        type: TYPES.NEGATIVE_STOCK,
        title: 'رصيد صنف تحت الصفر',
        body: `"${warning.item_name}" صار رصيده سالب بعد سند #${voucher.voucher_no}`,
        data: { item_id: warning.item_id, voucher_id: voucher.id },
      });
    }

    // أسطر بأصناف بلا سعر => مبالغها معلّقة لحد ما قصي يحدّد السعر
    const pending = view.filter((v) => v.price_pending);
    if (pending.length) {
      await notifyAdmins(client, {
        type: TYPES.PENDING_PRICE,
        title: 'سند فيه أسعار معلّقة',
        body: `سند #${voucher.voucher_no} فيه ${countItems(pending.length)} بلا سعر` +
              ` - ما بينحسب على ${totals.entity_name || 'المستودع'} لحد ما تحدّد الأسعار`,
        data: { voucher_id: voucher.id, item_ids: pending.map((v) => v.item_id) },
      });
    }

    return {
      voucher: redactVoucher(withLabel(totals), req.user),
      lines: view.map((t) => redactTransaction({ ...t, kind_label: KIND_LABELS[t.kind] }, req.user)),
      warnings,
    };
  }).catch(async (err) => {
    // طلبان بنفس الرمز وصلوا بنفس اللحظة: الفهرس الفريد رفض التاني
    if (err.code === '23505' && input.client_token) {
      const existing = await findByToken(input.client_token, req.user);
      if (existing) return { ...existing, warnings: [], duplicate: true };
    }
    throw err;
  });

  res.status(result.duplicate ? 200 : 201).json(result);
}));

/** سند مثبّت مسبقاً بنفس الرمز (منع الازدواج) */
async function findByToken(token, user) {
  const { rows } = await db.query(
    'SELECT id FROM vouchers WHERE client_token = $1 AND deleted_at IS NULL LIMIT 1', [token],
  );
  if (!rows[0]) return null;
  return loadVoucher(db, rows[0].id, user);
}

/** حذف سند: السند وكل أسطره مع بعض - الأرصدة بترجع تلقائياً */
router.delete('/:id', requireRole('admin', 'recorder'), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'رقم السند');

  const removed = await db.withTransaction(async (client) => {
    // قفل السطر: بيمنع حذفين متزامنين لنفس السند
    const { rows: locked } = await client.query(
      'SELECT * FROM vouchers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id],
    );
    const voucher = locked[0];
    if (!voucher) throw badRequest('السند غير موجود أو محذوف أصلاً', 404);

    const { rows: before } = await client.query(
      'SELECT * FROM v_transactions WHERE voucher_id = $1 ORDER BY id', [id],
    );

    await client.query(
      `UPDATE transactions SET deleted_at = now(), deleted_by = $1
       WHERE voucher_id = $2 AND deleted_at IS NULL`,
      [req.user.id, id],
    );
    await client.query(
      'UPDATE vouchers SET deleted_at = now(), deleted_by = $1 WHERE id = $2', [req.user.id, id],
    );

    await logAudit(client, {
      user: req.user, action: 'delete', table: 'vouchers', recordId: id,
      before: { ...voucher, lines: before },
      summary: `حذف سند #${voucher.voucher_no} (${KIND_LABELS[voucher.kind]}` +
               `${before[0]?.entity_name ? ' - ' + before[0].entity_name : ''}` +
               ` - ${countItems(before.length)})`,
      ip: req.ip,
    });
    if (req.user.role !== 'admin') {
      await notifyAdmins(client, {
        type: TYPES.TXN_EDITED,
        title: 'حذف سند',
        body: `${req.user.display_name} حذف سند #${voucher.voucher_no} (${countItems(before.length)})`,
        data: { voucher_id: id },
      });
    }
    return { voucher_no: voucher.voucher_no, line_count: before.length };
  });

  res.json({ ok: true, ...removed });
}));

module.exports = router;
