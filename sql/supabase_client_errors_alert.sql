-- ============================================
-- طالب علم — جدولة تنبيه الأعطال + التنظيف التلقائي (اختياري)
-- شغّله بعد supabase_client_errors.sql
-- ============================================
-- ⚠️ استبدل القيمتين تحت بقيمك الحقيقية من غير علامتي < >:
--   - ضع_مفتاح_anon_القديم_هنا → الـ anon key (Legacy، بيبدأ بـ eyJ...)
--   - ضع_WEBHOOK_SECRET_هنا    → نفس قيمة سر WEBHOOK_SECRET في Supabase

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- فحص كل 30 دقيقة: لو الأعطال عدّت الحد، بتبعتلك تليجرام
select cron.schedule(
  'client_errors_alert',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://urpzmcvftooacnnwdpqn.supabase.co/functions/v1/client-errors-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ضع_مفتاح_anon_القديم_هنا',
      'x-webhook-secret', 'ضع_WEBHOOK_SECRET_هنا'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- تنظيف يومي الساعة 3:15 فجرًا: مسح أي تقرير أقدم من 30 يوم
select cron.schedule(
  'client_errors_cleanup',
  '15 3 * * *',
  $$delete from public.client_errors where created_at < now() - interval '30 days'$$
);
