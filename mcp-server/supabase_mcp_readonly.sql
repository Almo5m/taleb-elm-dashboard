-- ============================================
-- طالب علم — صلاحية القراءة فقط لسيرفر الـ MCP
-- شغّل الكود ده في: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================
--
-- الفكرة: role جديد اسمه mcp_readonly عنده SELECT بس على الجداول اللي
-- سيرفر الـ MCP محتاجها. الصلاحية دي مفروضة من الداتابيز نفسها، مش من كود
-- الـ Worker — يعني حتى لو حصل خطأ في الكود أو حاول حد يعدّل الطلب اللي
-- بيتبعت، أي محاولة INSERT/UPDATE/DELETE هترفض من بوستجرس مباشرة لإن
-- الـ role أصلاً مالوش صلاحية الكتابة دي خالص.

-- do block عشان لو السكريبت اتشغّل قبل كده وفشل في نص الطريق، ما يديش
-- خطأ "role already exists" ويقدر يكمل عادي
do $$
begin
  if not exists (select from pg_roles where rolname = 'mcp_readonly') then
    create role mcp_readonly nologin bypassrls;
  end if;
end $$;

grant usage on schema public to mcp_readonly;

-- بنمنح الصلاحية لكل جدول لو موجود بس، عشان لو جدول من دول لسه متعملش
-- (زي religious_collections) السكريبت مايقفش على أول خطأ ويكمّل الباقي.
do $$
declare
  candidate_tables text[] := array[
    'profiles',
    'user_stats',
    'forum_threads',
    'forum_replies',
    'forum_reports',
    'ai_usage_daily',
    'ai_usage_monthly',
    'ai_access',
    'admin_audit_log',
    'banned_words',
    'announcements',
    'app_settings',
    'study_plan_tasks',
    'achievements_catalog',
    'religious_collections',
    'sadaqah',
    'sadaqah_jariyah'
  ];
  t text;
begin
  foreach t in array candidate_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select on public.%I to mcp_readonly', t);
    else
      raise notice 'تجاهلت جدول غير موجود: %', t;
    end if;
  end loop;
end $$;

-- عشان PostgREST يقدر يبدّل لـ role ده لما يوصله JWT فيه "role": "mcp_readonly"
grant mcp_readonly to authenticator;
