-- ============================================================
-- ترقية الطلاب (نقل الصفوف) من اللوحة: معاينة + نسخة احتياطية + تنفيذ في معاملة واحدة
-- ------------------------------------------------------------
-- القواعد (بتتطبق على كل طالب مطابق للفلتر):
--   * الأول ← الثاني (كل الأنظمة): الشعبة تتصفّر (null). الطالب بيختار من التطبيق.
--   * الثاني ← الثالث، الثانوية العامة: «علمي» تتصفّر (هيختار علوم أو رياضة من التطبيق)، و«أدبي» تفضل.
--   * الثاني ← الثالث، البكالوريا والأزهر: الشعبة تفضل زي ما هي.
--   * الصف الثالث مبيتحركش (بيتخرج). النقل من الثالث مرفوض.
--
-- ⚠️ الترتيب: انقل (الثاني ← الثالث) الأول وبعدين (الأول ← الثاني). لو عكست، اللي اتنقل من الأول
--    هيتنقل تاني مع الثاني.
--
-- مين بيتأثر: حسابات الطلاب بس (role = student أو فاضي) واللي نظامهم من القايمة الرسمية.
-- اللي نظامهم قيمة قديمة (زي «عام») بيظهروا في المعاينة كـ "غير مشمولين" ومابيتحركوش،
-- صحّحهم الأول بـ supabase_division_fix.sql.
--
-- الدوال دي SECURITY INVOKER: بتشتغل بصلاحيات الأدمن اللي بينادي عليها (RLS والـ trigger اللي بيمنع
-- الطالب من تغيير تقسيمه بيسمحوا للأدمن). وفوق كده بتتأكد إنه أدمن.
-- التنفيذ في معاملة واحدة: لو العدد الفعلي مختلف عن اللي ظهر في المعاينة (حد غيّر حاجة في نفس الوقت)
-- بيترفض كله ومفيش حاجة بتتغيّر.
--
-- الملف آمن لو اتشغّل أكتر من مرة. الأسماء الرسمية لازم تفضل مطابقة لـ src/lib/divisions.js
-- ============================================================

create or replace function public.promotion_to_grade(p_grade text)
returns text
language sql
immutable
as $$
  select case p_grade
    when 'الصف الأول الثانوي' then 'الصف الثاني الثانوي'
    when 'الصف الثاني الثانوي' then 'الصف الثالث الثانوي'
    else null
  end
$$;

create or replace function public.promotion_to_track(p_system text, p_grade text, p_track text)
returns text
language sql
immutable
as $$
  select case
    when p_grade = 'الصف الأول الثانوي' then null
    when p_grade = 'الصف الثاني الثانوي' and p_system = 'الثانوية العامة' and p_track = 'علمي' then null
    else nullif(btrim(p_track), '')
  end
$$;

-- فحص مشترك: أدمن + صف مصدر صالح + نظام رسمي (أو null = الكل)
create or replace function public.promotion_check_args(p_system text, p_from_grade text)
returns void
language plpgsql
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only: الترقية للأدمن بس';
  end if;
  if p_from_grade not in ('الصف الأول الثانوي', 'الصف الثاني الثانوي') then
    raise exception 'invalid_from_grade: الصف المصدر لازم يكون الأول أو الثاني (الثالث مبيتحركش)';
  end if;
  if p_system is not null and p_system not in ('الثانوية العامة', 'البكالوريا المصرية', 'الأزهر الشريف') then
    raise exception 'invalid_system: النظام مش من القايمة الرسمية';
  end if;
end;
$$;

-- المعاينة: لكل توليفة (نظام + شعبة حالية) هتتحوّل لإيه وكام طالب. skipped = غير مشمول (نظامه مش رسمي)
create or replace function public.admin_promotion_preview(p_system text, p_from_grade text)
returns table (system text, from_track text, to_grade text, to_track text, students bigint, skipped boolean)
language plpgsql
stable
as $$
begin
  perform public.promotion_check_args(p_system, p_from_grade);
  return query
  select
    p.system,
    nullif(btrim(p.track), ''),
    case when s.official then public.promotion_to_grade(p.grade) end,
    case when s.official then public.promotion_to_track(p.system, p.grade, p.track) end,
    count(*)::bigint,
    not s.official
  from public.profiles p
  cross join lateral (
    select coalesce(p.system in ('الثانوية العامة', 'البكالوريا المصرية', 'الأزهر الشريف'), false) as official
  ) s
  where coalesce(p.role, 'student') = 'student'
    and p.grade = p_from_grade
    and (p_system is null or p.system = p_system or not s.official)
  group by p.system, nullif(btrim(p.track), ''), s.official,
           public.promotion_to_grade(p.grade),
           public.promotion_to_track(p.system, p.grade, p.track)
  order by not s.official, p.system, 2;
end;
$$;

-- نسخة احتياطية: الطلاب اللي هيتأثروا بالظبط (قبل التنفيذ) بقيمهم الحالية
create or replace function public.admin_promotion_students(p_system text, p_from_grade text)
returns table (id uuid, system text, grade text, track text)
language plpgsql
stable
as $$
begin
  perform public.promotion_check_args(p_system, p_from_grade);
  return query
  select p.id, p.system, p.grade, nullif(btrim(p.track), '')
  from public.profiles p
  where coalesce(p.role, 'student') = 'student'
    and p.grade = p_from_grade
    and p.system in ('الثانوية العامة', 'البكالوريا المصرية', 'الأزهر الشريف')
    and (p_system is null or p.system = p_system)
  order by p.system, p.id;
end;
$$;

-- التنفيذ: معاملة واحدة، وبيتأكد إن العدد الفعلي = العدد اللي ظهر في المعاينة
create or replace function public.admin_promote_students(p_system text, p_from_grade text, p_expected int)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  perform public.promotion_check_args(p_system, p_from_grade);

  update public.profiles p
  set grade = public.promotion_to_grade(p.grade),
      track = public.promotion_to_track(p.system, p.grade, p.track)
  where coalesce(p.role, 'student') = 'student'
    and p.grade = p_from_grade
    and p.system in ('الثانوية العامة', 'البكالوريا المصرية', 'الأزهر الشريف')
    and (p_system is null or p.system = p_system);

  get diagnostics v_count = row_count;

  if p_expected is null or v_count <> p_expected then
    raise exception 'count_mismatch: المعاينة كانت % طالب لكن الفعلي %. ماحصلش أي تغيير، اعمل معاينة جديدة', p_expected, v_count;
  end if;

  return v_count;
end;
$$;

revoke all on function public.promotion_check_args(text, text) from public, anon;
revoke all on function public.admin_promotion_preview(text, text) from public, anon;
revoke all on function public.admin_promotion_students(text, text) from public, anon;
revoke all on function public.admin_promote_students(text, text, int) from public, anon;
grant execute on function public.promotion_check_args(text, text) to authenticated;
grant execute on function public.admin_promotion_preview(text, text) to authenticated;
grant execute on function public.admin_promotion_students(text, text) to authenticated;
grant execute on function public.admin_promote_students(text, text, int) to authenticated;
