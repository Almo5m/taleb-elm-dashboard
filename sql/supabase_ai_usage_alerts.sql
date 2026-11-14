-- ============================================================
-- المساعد الذكي: عدّاد استخدام دقيق + تنبيه تليجرام قبل وصول السقف الشهري
-- ------------------------------------------------------------
-- 1) ai_record_usage: زيادة عدّاد اليوم والشهر في خطوة واحدة (ذرّية).
--    الطريقة القديمة كانت بتقرأ العدد وبعدين تكتب +1، فلو طالبين بعتوا في نفس اللحظة
--    الاتنين بيكتبوا نفس الرقم وبيضيع عدّ واحد. كل ما الطلاب يزيدوا ده بيزيد، والسقف
--    الشهري كان ممكن يتعدّى من غير ما نحس.
--
-- 2) ai_usage_alerts: بتسجّل أي تنبيه اتبعت (شهر + نسبة + قيمة السقف وقتها)، عشان تنبيه
--    الـ 80% والـ 100% يتبعتوا مرة واحدة بس. ولو رفعت السقف، التنبيهات بتبدأ من جديد.
--
-- الفنكشن ai-assistant بيشتغل صح حتى لو الملف ده لسه ماتشغّلش (بيرجع للطريقة القديمة
-- من غير تنبيهات)، فمفيش مشكلة في ترتيب التشغيل. بس شغّل الملف قبل نشر الفنكشن عشان
-- التنبيهات تشتغل من أول رسالة.
--
-- الملف آمن لو اتشغّل أكتر من مرة.
-- ============================================================

create or replace function public.ai_record_usage(
  p_user_id uuid,
  p_usage_date date,
  p_month text
)
returns table (daily_count int, monthly_count int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daily int;
  v_monthly int;
begin
  insert into public.ai_usage_daily (user_id, usage_date, message_count)
  values (p_user_id, p_usage_date, 1)
  on conflict (user_id, usage_date)
  do update set message_count = ai_usage_daily.message_count + 1
  returning message_count into v_daily;

  insert into public.ai_usage_monthly (month, message_count)
  values (p_month, 1)
  on conflict (month)
  do update set message_count = ai_usage_monthly.message_count + 1
  returning message_count into v_monthly;

  return query select v_daily, v_monthly;
end;
$$;

revoke all on function public.ai_record_usage(uuid, date, text) from public, anon, authenticated;
grant execute on function public.ai_record_usage(uuid, date, text) to service_role;

create table if not exists public.ai_usage_alerts (
  month text not null,        -- 'yyyy-MM'
  threshold int not null,     -- نسبة من السقف: 80 أو 100
  cap int not null,           -- قيمة السقف الشهري وقت التنبيه
  sent_at timestamptz not null default now(),
  primary key (month, threshold, cap)
);

alter table public.ai_usage_alerts enable row level security;
revoke all on public.ai_usage_alerts from anon, authenticated;
