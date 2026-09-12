'use strict';
/** سجل التدقيق: كل إنشاء/تعديل/حذف بينتسجّل مع القيم قبل وبعد */

async function logAudit(db, {
  user, action, table, recordId, before = null, after = null, summary = null, ip = null,
}) {
  await db.query(
    `INSERT INTO audit_log (user_id, username, action, table_name, record_id,
                            before_data, after_data, summary, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      user?.id ?? null,
      user?.username ?? null,
      action,
      table,
      recordId == null ? null : String(recordId),
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      summary,
      ip,
    ],
  );
}

/** الفروقات بين نسختين - بيسهّل قراءة سجل التدقيق */
function diffFields(before, after) {
  const changed = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const a = before?.[key];
    const b = after?.[key];
    const norm = (v) => (v instanceof Date ? v.toISOString() : v);
    if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) {
      changed[key] = { from: norm(a) ?? null, to: norm(b) ?? null };
    }
  }
  return changed;
}

module.exports = { logAudit, diffFields };
