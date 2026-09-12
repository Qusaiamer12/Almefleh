'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

/** اشتقاق مفتاح 32 بايت من الإعداد */
function keyBytes() {
  const raw = config.credKey;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.scryptSync(raw, 'almefleh-cred-salt', 32);
}

/**
 * تشفير قابل لفك التشفير - بينستعمل فقط عشان الأدمن (قصي) يقدر يشوف
 * باسوردات الحسابات حسب متطلّبات النظام. التحقق من الدخول بيصير عبر bcrypt.
 */
function encryptSecret(plain) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decryptSecret(payload) {
  if (!payload) return null;
  try {
    const [ivB64, tagB64, dataB64] = String(payload).split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // تغيّر المفتاح أو بيانات تالفة
  }
}

function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), 10);
}

function verifyPassword(plain, hash) {
  try { return bcrypt.compareSync(String(plain), String(hash)); }
  catch { return false; }
}

/** التحقق من قوة كلمة السر (بسيطة ومناسبة لفريق صغير) */
function validatePassword(plain) {
  const p = String(plain || '');
  if (p.length < 6) return 'كلمة السر لازم تكون ٦ خانات على الأقل';
  return null;
}

module.exports = { encryptSecret, decryptSecret, hashPassword, verifyPassword, validatePassword };
