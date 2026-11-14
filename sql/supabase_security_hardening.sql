-- ============================================================
-- تقوية الأمان (مرة واحدة، آمن لو اتشغّل أكتر من مرة)
-- ------------------------------------------------------------
-- 1) ai_rate_limit و ai_error_alert_state اتعملوا من غير RLS، يعني أي حد معاه الـ anon key
--    (وهو جوه التطبيق وأي حد يطلّعه) كان يقدر يقراهم ويعدّلهم من الـ API:
--      - يمسح صف الـ rate limit بتاعه ويتخطى حد الـ 15 رسالة/دقيقة.
--      - يبوّظ last_alert_at فتنبيهات فشل المساعد في تليجرام تقف.
--    الفنفشنز بتستخدم service_role اللي بيتخطى RLS، فمفيش حاجة هتتأثر.
--
-- 2) notify_telegram كانت قابلة للنداء من أي حد عن طريق /rest/v1/rpc (مش مقفولة).
--    يعني أي حد يبعتلك رسايل تليجرام مزيّفة بالمحتوى اللي هو عايزه. دلوقتي مقفولة،
--    والـ triggers لسه شغّالة لأن notify_telegram_trigger بتشتغل بصلاحيات صاحب الدالة.
--
-- 3) search_path ثابت على دوال التليجرام (دوال SECURITY DEFINER لازم يكون ليها search_path).
-- ============================================================

alter table public.ai_rate_limit enable row level security;
alter table public.ai_error_alert_state enable row level security;
revoke all on public.ai_rate_limit from anon, authenticated;
revoke all on public.ai_error_alert_state from anon, authenticated;

alter function public.notify_telegram(text, text, jsonb) set search_path = public;
alter function public.notify_telegram_trigger() set search_path = public;
revoke execute on function public.notify_telegram(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.notify_telegram_trigger() from public, anon, authenticated;
