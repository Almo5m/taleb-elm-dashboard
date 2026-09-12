-- ============================================
-- طالب علم — تحسينات باك اند/لوحة تحكم إضافية (v2)
-- شغّل الكود ده بعد supabase_admin_improvements.sql
-- ============================================

-- ==========================================================
-- 1) Rate limiting: منع رسايل متلاحقة بسرعة غير طبيعية
-- ==========================================================
create table if not exists public.ai_rate_limit (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_request_at timestamptz not null default now()
);
-- مفيش RLS ولا policies هنا عمدًا — الجدول ده بيتقرا ويتكتب من
-- ai-assistant بمفتاح service_role بس، مش محتاج يبان لحد تاني خالص.

-- ==========================================================
-- 2) Debounce لتنبيهات فشل Gemini (عشان لو حصل outage مايغرقش تليجرام)
-- ==========================================================
create table if not exists public.ai_error_alert_state (
  id boolean primary key default true, -- صف واحد بس دايمًا
  last_alert_at timestamptz,
  constraint single_row check (id)
);
insert into public.ai_error_alert_state (id) values (true) on conflict (id) do nothing;

-- ==========================================================
-- 3) عمود تصنيف الأسئلة (بيتملى لاحقًا من classify-ai-questions)
-- ==========================================================
alter table public.ai_chat_logs add column if not exists category text;

-- ==========================================================
-- 4) Retention إضافي: بلاغات المنتدى المحلولة الأقدم من 180 يوم
-- ==========================================================
select cron.schedule(
  'forum_reports_cleanup',
  '0 4 * * *',
  $$delete from public.forum_reports where status = 'resolved' and created_at < now() - interval '180 days'$$
);

-- ==========================================================
-- 5) تصنيف الأسئلة تلقائيًا مرة يوميًا (دفعة واحدة، مش لكل رسالة)
-- ==========================================================
-- ⚠️ عدّل السطرين المعلّمين بنفس القيم اللي استخدمتها في
-- supabase_admin_improvements.sql (الرابط والـ anon key والـ webhook secret)
select cron.schedule(
  'classify_ai_questions_daily',
  '30 3 * * *',
  $$
  select net.http_post(
    url := 'https://urpzmcvftooacnnwdpqn.supabase.co/functions/v1/classify-ai-questions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVycHptY3ZmdG9vYWNubndkcHFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NzI4OTcsImV4cCI6MjEwMDA0ODg5N30.pRAHXSAcktKqL0trbUW6Ckpi3UWWjMzA1nce3O8NI8o',
      'x-webhook-secret', 'taleb-elm-webhook-9f3a7c2e1b'
    ),
    body := '{}'::jsonb
  );
  $$
);
