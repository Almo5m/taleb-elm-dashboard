-- ============================================================
-- تقييد قراءة user_stats للمسجّلين بس (خصوصية الطلاب)
-- ------------------------------------------------------------
-- المشكلة: policy القراءة كانت using (true) من غير "to authenticated"،
-- يعني أي حد معاه الـ anon key (حتى من غير تسجيل دخول) كان يقدر يقرأ
-- الاسم والصورة والإحصائيات.
--
-- الملف ده بيعمل حاجتين وبس، وآمن لو اتشغّل أكتر من مرة:
--   1) أي policy قراءة (SELECT أو ALL) على user_stats مفتوحة للجميع
--      بتتحوّل لـ authenticated. الشرط (using) نفسه مش بيتغيّر.
--   2) بيسحب صلاحية الجدول من anon كطبقة حماية تانية.
--
-- مش بيغيّر: policies الكتابة (الطالب لسه يقدر يعدّل أرقامه).
-- ده بند منفصل لسه مفتوح.
-- ============================================================

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename  = 'user_stats'
      and cmd in ('SELECT', 'ALL')
      and roles @> array['public']::name[]
  loop
    execute format('alter policy %I on public.user_stats to authenticated', pol.policyname);
    raise notice 'اتقيّدت للمسجّلين: %', pol.policyname;
  end loop;
end $$;

revoke all on table public.user_stats from anon;

-- ============================================================
-- تحقق (شغّل كل واحد لوحده بعد الملف):
--
-- 1) المتوقع: كل صفوف القراءة roles = {authenticated} (مفيش public ولا anon)
--    select policyname, cmd, roles from pg_policies where tablename = 'user_stats';
--
-- 2) المتوقع: خطأ "permission denied for table user_stats"
--    begin; set local role anon; select count(*) from public.user_stats; rollback;
-- ============================================================
