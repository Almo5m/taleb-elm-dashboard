-- ============================================================
-- المساعد الذكي: حالة الموديلات (أنهي موديل خلصت حصته ولحد إمتى)
-- شغّله مرة واحدة في: Supabase Dashboard → SQL Editor → New Query → Run
-- ------------------------------------------------------------
-- ليه: الدالة ai-assistant دلوقتي بتجرّب الموديل الأساسي وبعده البدائل (fallback_models في
-- إعدادات المساعد). لما موديل يرجّع "الحصة اليومية خلصت" بتسجّله هنا ولحد إمتى، فباقي الطلبات
-- بتتخطّاه فورًا من غير ما تضرب جوجل وتاخد ٤٢٩ تاني. اللوحة بتقرا الجدول ده لعرض "حالة الموديلات".
--
-- صفوف المفاتيح اللي بتبدأ بـ "__" (زي __all_exhausted__) مش موديلات، دي حالات تنبيه داخلية.
-- الدالة بتشتغل عادي لو الملف ده لسه ماتشغّلش (من غير حفظ الحالة)، بس شغّله قبل النشر.
-- الملف آمن لو اتشغّل أكتر من مرة.
-- ============================================================

create table if not exists public.ai_model_state (
  model text primary key,
  exhausted_until timestamptz,        -- لحد إمتى بنتخطّى الموديل ده (null = مفيش)
  reason text,                         -- quota_daily | quota_minute | overloaded | timeout | bad_model | all_exhausted
  detail text,                         -- أول جزء من رسالة الخطأ الأصلية
  alerted_at timestamptz,              -- آخر تنبيه تليجرام (للحالات الداخلية)
  updated_at timestamptz not null default now()
);

alter table public.ai_model_state enable row level security;

-- القراءة للأدمن بس (لوحة التحكم). الكتابة من الدالة بـ service role اللي بيتجاوز RLS.
drop policy if exists "Admins can view ai_model_state" on public.ai_model_state;
create policy "Admins can view ai_model_state"
  on public.ai_model_state for select
  using (public.is_admin());

create index if not exists ai_model_state_until_idx on public.ai_model_state (exhausted_until);
