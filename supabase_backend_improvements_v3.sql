-- ============================================
-- طالب علم — v3: التقرير الأسبوعي بس (الـ retention اتلغى)
-- شغّل الكود ده بعد v2
-- ============================================

-- لو كنت شغّلت نسخة سابقة فيها views تحليل النشاط، بنشيلها هنا —
-- تجاهل أي رسالة "does not exist" لو مكنتش شغّلتها أصلاً
drop view if exists public.student_retention_status;
drop view if exists public.student_activity_summary;

-- ==========================================================
-- جدولة التقرير الأسبوعي — كل جمعة الساعة 9 مساءً
-- ==========================================================
-- ⚠️ عدّل نفس القيم اللي في باقي الملفات (الرابط والـ anon key والـ webhook secret)
select cron.schedule(
  'weekly_report',
  '0 21 * * 5',
  $$
  select net.http_post(
    url := 'https://urpzmcvftooacnnwdpqn.supabase.co/functions/v1/weekly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ضع_مفتاح_anon_القديم_هنا',
      'x-webhook-secret', 'taleb-elm-webhook-9f3a7c2e1b'
    ),
    body := '{}'::jsonb
  );
  $$
);
