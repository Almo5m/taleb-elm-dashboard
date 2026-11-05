-- push_notifications_log: سجل كل إشعار Push اتبعت من لوحة التحكم (عام
-- لكل المستخدمين أو لمستخدم واحد بس)، مع حالته. شغّله مرة واحدة في
-- Supabase SQL Editor (بعد supabase_admin.sql، محتاجين is_admin() منه).

CREATE TABLE IF NOT EXISTS push_notifications_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('all', 'single_user')),
  target_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE push_notifications_log ENABLE ROW LEVEL SECURITY;

-- الأدمن بس يقدر يشوف السجل (من اللوحة). الإدراج/التحديث بيحصلوا من
-- Edge Function بـ service_role، اللي بيتخطى RLS تلقائيًا فمحتاجينش
-- policy منفصلة للكتابة هنا.
DROP POLICY IF EXISTS "الأدمن بس يشوف سجل الإشعارات" ON push_notifications_log;
CREATE POLICY "الأدمن بس يشوف سجل الإشعارات"
  ON push_notifications_log
  FOR SELECT
  USING (public.is_admin());
