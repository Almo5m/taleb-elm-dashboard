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
                           'weekly_report','client_errors_alert','client_errors_cleanup']) as j
  union all select 'table: ' || t, to_regclass('public.' || t) is not null
         from unnest(array['ai_chat_logs','ai_rate_limit','client_errors','device_tokens','push_notifications_log']) as t
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
  union all select 'مفيش placeholder متسيّب في الـ cron',
         not exists(select 1 from cron.job where strpos(command, 'ضع_') > 0)
  union all select 'مفيش placeholder في notify_telegram',
         strpos(pg_get_functiondef('public.notify_telegram(text,text,jsonb)'::regprocedure), 'ضع_') = 0
  union all select 'role mcp_readonly اتشال',
         not exists(select 1 from pg_roles where rolname = 'mcp_readonly')
) x
order by 2, 1;
