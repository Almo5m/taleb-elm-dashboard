-- ============================================================
-- فحص الأمان (قراءة بس، آمن تشغّله في أي وقت)
-- كل قسم المفروض يرجّع صفر صفوف. أي صف = مشكلة محتاجة تتصلّح.
-- ============================================================

-- 1) جداول في public من غير RLS (أي حد معاه الـ anon key يقراها ويكتب فيها)
select 'RLS مقفول' as problem, c.relname as name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
union all
-- 2) دوال public الـ API يقدر ينادي عليها (anon أو authenticated) وهي SECURITY DEFINER
--    (بتشتغل بصلاحيات صاحبها). راجع كل واحدة: لازم تكون مقصودة (زي is_staff للـ policies)
select 'دالة definer مفتوحة للـ API', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and p.prorettype <> 'trigger'::regtype
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
union all
-- 3) دوال SECURITY DEFINER من غير search_path ثابت
select 'definer من غير search_path', p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
order by 1, 2;

-- ملاحظة: is_staff() (و is_admin() لو موجودة) مفروض تظهر في القسم 2: الـ RLS محتاجاها.
