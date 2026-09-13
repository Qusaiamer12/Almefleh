'use strict';
/**
 * سجلّات منظّمة بدون أي مكتبة خارجية.
 * بالإنتاج: سطر JSON لكل حدث (سهل البحث فيه بلوحة Render).
 * بالتطوير: سطر مقروء بالعربي.
 */
const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] || (config.env === 'production' ? LEVELS.info : LEVELS.debug);

/** إخفاء أي حقل حسّاس قبل ما ينكتب بالسجل */
const SECRET_KEYS = /pass|secret|token|cookie|authorization|password_enc|credential/i;
function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEYS.test(key) ? '[محجوب]' : redact(val, depth + 1);
  }
  return out;
}

function emit(level, message, fields = {}) {
  if (LEVELS[level] < threshold) return;
  const payload = { level, msg: message, time: new Date().toISOString(), ...redact(fields) };

  if (config.env === 'production') {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  const extras = Object.entries(redact(fields))
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
  const tag = { debug: '·', info: 'ℹ', warn: '⚠', error: '✖' }[level];
  process.stdout.write(`${tag} ${message}${extras ? ' | ' + extras : ''}\n`);
}

module.exports = {
  debug: (m, f) => emit('debug', m, f),
  info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
  redact,
};
