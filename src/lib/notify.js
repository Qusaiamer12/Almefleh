'use strict';
/**
 * التنبيهات: هادئة (بتتجمّع على الجرس، بدون نوافذ منبثقة).
 * بتوصل لكل الحسابات اللي عندها notifications_on = true.
 * (حسب المتطلّب: أبو بلال وبلال مطفيّة عندهم)
 */

const TYPES = {
  NEGATIVE_STOCK: 'negative_stock',
  PRICE_CHANGE: 'price_change',
  CUSTOMER_REQUEST: 'customer_request',
  PENDING_PRICE: 'pending_price',
  TXN_EDITED: 'txn_edited',
  BACKUP_FAILED: 'backup_failed',
};

/** إرسال تنبيه لمجموعة مستخدمين حسب شرط SQL */
async function notify(db, { where = 'u.notifications_on = TRUE', params = [], type, title, body = null, data = null }) {
  const sql = `
    INSERT INTO notifications (user_id, type, title, body, data)
    SELECT u.id, $${params.length + 1}, $${params.length + 2}, $${params.length + 3}, $${params.length + 4}::jsonb
    FROM users u
    WHERE u.active = TRUE AND (${where})`;
  await db.query(sql, [...params, type, title, body, data ? JSON.stringify(data) : null]);
}

/** تنبيه للأدمن فقط */
async function notifyAdmins(db, payload) {
  return notify(db, { ...payload, where: "u.role = 'admin' AND u.notifications_on = TRUE" });
}

/** تنبيه لكل المشتركين بالتنبيهات */
async function notifyAll(db, payload) {
  return notify(db, { ...payload, where: 'u.notifications_on = TRUE' });
}

module.exports = { notify, notifyAdmins, notifyAll, TYPES };
