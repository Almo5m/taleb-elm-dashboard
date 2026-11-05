-- device_tokens: توكن FCM لكل جهاز مربوط بحساب مستخدم — أساس إشعارات
-- الـ Push (العامة والفردية) من لوحة التحكم. شغّله مرة واحدة في Supabase
-- SQL Editor.

CREATE TABLE IF NOT EXISTS device_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'android',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_tokens_user_id_idx ON device_tokens(user_id);

ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;

-- كل مستخدم يقدر يسجّل/يحدّث توكن جهازه بس (مش توكنات مستخدمين تانيين)
DROP POLICY IF EXISTS "المستخدم يدير توكن جهازه بس" ON device_tokens;
CREATE POLICY "المستخدم يدير توكن جهازه بس"
  ON device_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- الأدمن بس (عن طريق service_role key في الـ Edge Function، مش anon key)
-- يقدر يقرا كل التوكنز عشان يبعت الإشعارات — مفيش policy إضافية لازمة هنا
-- لأن service_role بيتخطى RLS تلقائيًا في Supabase.
