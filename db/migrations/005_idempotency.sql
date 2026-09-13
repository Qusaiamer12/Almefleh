-- ==========================================================================
-- منع ازدواج الحركات (double submit)
-- ==========================================================================
-- كل محاولة تسجيل من الواجهة بتحمل رمز فريد. إذا انبعت نفس الطلب مرتين
-- (دوسة مزدوجة على الآيباد، أو النت قطع والمتصفح أعاد الإرسال)، الطلب
-- التاني بيرجّع نفس الحركة الأولى بدل ما يسجّل وحدة جديدة.

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS client_token TEXT;

-- فريد بين الحركات الحيّة فقط (الحركة المحذوفة ما بتمنع إعادة التسجيل)
CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_client_token
  ON transactions (client_token) WHERE client_token IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS client_token_shape;
ALTER TABLE transactions ADD CONSTRAINT client_token_shape
  CHECK (client_token IS NULL OR length(client_token) BETWEEN 8 AND 64);
