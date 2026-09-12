'use strict';
require('dotenv').config();

const required = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`المتغيّر ${key} مطلوب بالإنتاج (شوف .env.example)`);
    }
    return fallback;
  }
  return v;
};

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  appName: 'نظام مستودعات المفلح',
  timezone: process.env.APP_TIMEZONE || 'Asia/Amman',
  currency: process.env.CURRENCY || 'د.أ',

  databaseUrl: required('DATABASE_URL', 'postgresql://postgres@127.0.0.1:55432/almefleh_test'),
  dbSsl: String(process.env.DATABASE_SSL || '').toLowerCase() === 'true',

  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  // مفتاح تشفير بيانات الدخول (عشان الأدمن يقدر يشوفها) - 32 بايت hex أو أي نص
  credKey: required('CRED_KEY', 'dev-only-insecure-cred-key-change-me'),

  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@1234',
  seedDefaultPassword: process.env.SEED_DEFAULT_PASSWORD || 'Almefleh@2024',

  backup: {
    enabled: String(process.env.BACKUP_ENABLED || 'true').toLowerCase() === 'true',
    cron: process.env.BACKUP_CRON || '0 * * * *', // كل ساعة
    localDir: process.env.BACKUP_DIR || 'backups',
    keepLocal: Number(process.env.BACKUP_KEEP_LOCAL || 24),
    drive: {
      clientId: process.env.GDRIVE_CLIENT_ID || '',
      clientSecret: process.env.GDRIVE_CLIENT_SECRET || '',
      refreshToken: process.env.GDRIVE_REFRESH_TOKEN || '',
      folderId: process.env.GDRIVE_FOLDER_ID || '',
    },
  },
};
