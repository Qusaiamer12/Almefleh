'use strict';
const fs = require('fs/promises');
const path = require('path');
const cron = require('node-cron');
const db = require('../db');
const config = require('../config');

const TABLES = [
  'entities', 'users', 'items', 'item_prices', 'item_components',
  'transactions', 'price_proposals', 'customer_requests', 'notifications',
  'audit_log', 'settings',
];

/** سحب كل البيانات كـ JSON واحد */
async function dumpAll() {
  const data = {};
  for (const table of TABLES) {
    const { rows } = await db.query(`SELECT * FROM ${table} ORDER BY 1`);
    data[table] = rows;
  }
  return {
    meta: {
      app: config.appName,
      generated_at: new Date().toISOString(),
      timezone: config.timezone,
      version: 1,
      row_counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    },
    data,
  };
}

/** الحصول على access token من refresh token تاع جوجل درايف */
async function getDriveAccessToken() {
  const { clientId, clientSecret, refreshToken } = config.backup.drive;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`فشل تجديد توكن جوجل درايف: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

/** رفع الملف على فولدر جوجل درايف */
async function uploadToDrive(fileName, content) {
  const token = await getDriveAccessToken();
  if (!token) return { uploaded: false, reason: 'بيانات جوجل درايف مش مضبوطة' };

  const metadata = { name: fileName, mimeType: 'application/json' };
  if (config.backup.drive.folderId) metadata.parents = [config.backup.drive.folderId];

  const boundary = `almefleh-${Date.now()}`;
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  if (!res.ok) throw new Error(`فشل الرفع على جوجل درايف: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { uploaded: true, file_id: json.id, file_name: json.name };
}

/** حذف النسخ المحلية القديمة (قرص Render مؤقت أصلاً) */
async function pruneLocal(dir) {
  try {
    const files = (await fs.readdir(dir))
      .filter((f) => f.startsWith('almefleh-backup-') && f.endsWith('.json'))
      .sort()
      .reverse();
    for (const old of files.slice(config.backup.keepLocal)) {
      await fs.unlink(path.join(dir, old)).catch(() => {});
    }
  } catch { /* الفولدر مش موجود */ }
}

async function runBackup() {
  const started = Date.now();
  const dump = await dumpAll();
  const content = JSON.stringify(dump, null, 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `almefleh-backup-${stamp}.json`;

  const dir = path.isAbsolute(config.backup.localDir)
    ? config.backup.localDir
    : path.join(__dirname, '..', '..', config.backup.localDir);
  await fs.mkdir(dir, { recursive: true });
  const localPath = path.join(dir, fileName);
  await fs.writeFile(localPath, content, 'utf8');
  await pruneLocal(dir);

  let drive = { uploaded: false, reason: 'مش مفعّل' };
  try {
    drive = await uploadToDrive(fileName, content);
  } catch (err) {
    drive = { uploaded: false, error: err.message };
  }

  return {
    ok: true,
    file: fileName,
    local_path: localPath,
    size_bytes: Buffer.byteLength(content),
    rows: dump.meta.row_counts,
    drive,
    duration_ms: Date.now() - started,
  };
}

function scheduleBackups() {
  cron.schedule(config.backup.cron, async () => {
    try {
      const result = await runBackup();
      console.log(`[backup] ${result.file} (${result.size_bytes} بايت)` +
        (result.drive.uploaded ? ' - انرفعت على جوجل درايف' : ` - محلياً بس (${result.drive.reason || result.drive.error || ''})`));
      if (!result.drive.uploaded && config.backup.drive.refreshToken) {
        const { notifyAdmins, TYPES } = require('../lib/notify');
        await notifyAdmins(db, {
          type: TYPES.BACKUP_FAILED,
          title: 'فشل رفع النسخة الاحتياطية',
          body: result.drive.error || 'ما انرفعت على جوجل درايف',
        });
      }
    } catch (err) {
      console.error('[backup] فشل:', err.message);
    }
  }, { timezone: config.timezone });
  console.log(`[backup] مجدول: ${config.backup.cron} (${config.timezone})`);
}

module.exports = { runBackup, scheduleBackups, dumpAll };
