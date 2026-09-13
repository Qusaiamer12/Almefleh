-- ==========================================================================
-- تشديد المصادقة: إبطال الجلسات عند تغيير كلمة السر + حد لمحاولات الدخول
-- ==========================================================================

-- ---------- ١) إبطال التوكنات القديمة عند تغيير بيانات الدخول ----------
-- كل توكن بيحمل ختم وقت بيانات الدخول. إذا تغيّرت كلمة السر أو اليوزر،
-- كل الجلسات القديمة بتصير غير صالحة فوراً (حتى لو التوكن لسا ما انتهى).
ALTER TABLE users ADD COLUMN IF NOT EXISTS credentials_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ---------- ٢) سجل محاولات الدخول ----------
CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGSERIAL PRIMARY KEY,
  username   TEXT NOT NULL,
  ip         TEXT,
  success    BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user
  ON login_attempts (lower(username), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip
  ON login_attempts (ip, created_at DESC) WHERE success = FALSE;
-- للتنظيف الدوري
CREATE INDEX IF NOT EXISTS idx_login_attempts_cleanup ON login_attempts (created_at);

-- ---------- ٣) قفل الحساب ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
