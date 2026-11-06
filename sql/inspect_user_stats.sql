-- ============================================================
-- فحص جدول user_stats (قراءة بس — مابيغيّر حاجة)
-- الهدف: نعرف الأعمدة والـ policies والـ triggers قبل ما نمنع الغش في الأرقام،
-- لأن الجدول متعرّف في ريبو التطبيق، ومينفعش نمنع الكتابة من غير ما نعرف
-- التطبيق بيكتب إزاي (عشان منبوّظش المزامنة عند الطلاب).
-- شغّله في SQL Editor وابعت النتيجة كلها.
-- ============================================================
select 'rls' as kind,
       case when relrowsecurity then 'enabled' else 'DISABLED' end as detail
from pg_class where oid = 'public.user_stats'::regclass
union all
select 'column',
       column_name || ' : ' || data_type || coalesce(' default ' || column_default, '')
from information_schema.columns
where table_schema = 'public' and table_name = 'user_stats'
union all
select 'policy',
       policyname || ' | ' || cmd || ' | ' || roles::text
         || ' | using: ' || coalesce(qual, '-') || ' | check: ' || coalesce(with_check, '-')
from pg_policies
where schemaname = 'public' and tablename = 'user_stats'
union all
select 'trigger', tgname || ' | ' || pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.user_stats'::regclass and not tgisinternal
union all
select 'grant', grantee || ' : ' || privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'user_stats'
  and grantee in ('anon', 'authenticated')
order by 1, 2;
