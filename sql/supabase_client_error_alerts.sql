-- ============================================================
-- تنبيه تليجرام للباجات الحقيقية (3 أجهزة أو أكتر) والأعطال اللي رجعت بعد الإصلاح
-- ------------------------------------------------------------
-- بيتبنى على supabase_client_errors_v2.sql (الـ views)، وعلى الـ cron بتاع client-errors-alert
-- اللي بيشتغل كل 30 دقيقة (sql/supabase_client_errors_alert.sql).
--
-- الجدول ده بيسجّل أي تنبيه اتبعت (بصمة العطل + نوعه + مرجعه) عشان كل عطل يتنبّه عليه مرة واحدة:
--   alert_kind = 'new'       باج مفتوح وصل 3 أجهزة (ref فاضي)
--   alert_kind = 'regressed' عطل اتعلّم "اتصلح" ورجع (ref = الإصدار اللي اتعلّم فيه إنه اتصلح،
--                            فلو اتصلح تاني في إصدار أحدث ورجع تاني، بيتنبّه عليه تاني)
--
-- بعد تشغيل الملف انشر: supabase functions deploy client-errors-alert
-- الفنكشن بيشتغل صح حتى لو الملف ده لسه ماتشغّلش (بيتخطّى التنبيه الجديد).
-- الملف آمن لو اتشغّل أكتر من مرة.
-- ============================================================

create table if not exists public.client_error_alerts (
  signature text not null,
  alert_kind text not null check (alert_kind in ('new', 'regressed')),
  ref text not null default '',
  devices int,
  alerted_at timestamptz not null default now(),
  primary key (signature, alert_kind, ref)
);

alter table public.client_error_alerts enable row level security;
revoke all on public.client_error_alerts from anon, authenticated;
