-- ============================================================
-- فحص حالة قاعدة البيانات (قراءة بس — مابيغيّر حاجة، آمن تشغّله في أي وقت)
-- شغّله في SQL Editor. المتوقع: كل الصفوف ✅
-- أي ❌ اسمه بيقولك أنهي ملف في فولدر sql/ لسه ماتشغّلش.
-- لما تضيف ملف SQL جديد، ضيف له بند هنا.
-- ============================================================
select item, case when ok then '✅' else '❌' end as status
from (
  select 'trigger: prevent_profile_self_escalation_trigger (critical_security_fix)' as item,
         exists(select 1 from pg_trigger where tgname = 'prevent_profile_self_escalation_trigger') as ok
  union all select 'trigger: trg_notify_telegram_signup_complete_profiles (fix_signup_notification)',
         exists(select 1 from pg_trigger where tgname = 'trg_notify_telegram_signup_complete_profiles')
  union all select 'trigger القديم اتشال: trg_notify_telegram_insert_profiles',
         not exists(select 1 from pg_trigger where tgname = 'trg_notify_telegram_insert_profiles')
  union all select 'trigger: client_errors_limit_trigger (client_errors)',
         exists(select 1 from pg_trigger where tgname = 'client_errors_limit_trigger')
  union all select 'cron: ' || j, exists(select 1 from cron.job where jobname = j)
         from unnest(array['ai_chat_logs_cleanup','classify_ai_questions_daily','forum_reports_cleanup',
                           'weekly_report','client_errors_alert','client_errors_cleanup','user_stats_flags_cleanup']) as j
  union all select 'table: ' || t, to_regclass('public.' || t) is not null
         from unnest(array['ai_chat_logs','ai_rate_limit','client_errors','device_tokens','push_notifications_log','user_stats_flags','user_stats_guard_config','ai_usage_alerts','client_error_status','client_error_alerts']) as t
  union all select 'ai_rate_limit.' || c || ' (rate_limit_upgrade)',
         exists(select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'ai_rate_limit' and column_name = c)
         from unnest(array['window_start','request_count']) as c
  union all select 'user_stats: مفيش policy قراءة مفتوحة للجميع (user_stats_privacy)',
         not exists(select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'user_stats'
                      and cmd in ('SELECT','ALL') and roles @> array['public']::name[])
  union all select 'user_stats: anon مالوش صلاحية قراءة',
         not has_table_privilege('anon', 'public.user_stats', 'SELECT')
  union all select 'trigger: user_stats_guard_trigger (user_stats_guard)',
         exists(select 1 from pg_trigger where tgname = 'user_stats_guard_trigger')
  union all select 'RLS شغّال: ai_rate_limit (security_hardening)',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.ai_rate_limit')), false)
  union all select 'RLS شغّال: ai_error_alert_state (security_hardening)',
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.ai_error_alert_state')), false)
  union all select 'notify_telegram مقفولة قدام الـ API (security_hardening)',
         not has_function_privilege('anon', 'public.notify_telegram(text,text,jsonb)', 'execute')
         and not has_function_privilege('authenticated', 'public.notify_telegram(text,text,jsonb)', 'execute')
  union all select 'function: ai_record_usage (ai_usage_alerts)',
         to_regprocedure('public.ai_record_usage(uuid,date,text)') is not null
  union all select 'view: ' || v || ' (client_errors_v2)', to_regclass('public.' || v) is not null
         from unnest(array['client_error_groups','client_error_daily']) as v
  union all select 'trigger: trg_auto_enable_ai_new_profile (ai_auto_enable، اختياري)',
         exists(select 1 from pg_trigger where tgname = 'trg_auto_enable_ai_new_profile')
  union all select 'user_stats: authenticated مالوش TRUNCATE',
         not has_table_privilege('authenticated', 'public.user_stats', 'TRUNCATE')
  union all select 'مفيش placeholder متسيّب في الـ cron',
         not exists(select 1 from cron.job where strpos(command, 'ضع_') > 0)
  union all select 'مفيش placeholder في notify_telegram',
         strpos(pg_get_functiondef('public.notify_telegram(text,text,jsonb)'::regprocedure), 'ضع_') = 0
  union all select 'role mcp_readonly اتشال',
         not exists(select 1 from pg_roles where rolname = 'mcp_readonly')
) x
order by 2, 1;
