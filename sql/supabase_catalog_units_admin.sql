-- ============================================================
-- دروس المنهج: إحصائيات الوحدات لكل مادة (للوحة)
-- ------------------------------------------------------------
-- كارت "تغطية المنهج" وقايمة المواد محتاجين يعرفوا لكل مادة: كام وحدة، وكام درس لسه من غير وحدة.
-- حساب ده في المتصفح معناه تحميل كل الدروس، فالعدّ هنا في view واحدة.
--
-- بتتبني على جدول catalog_units وعمود catalog_lessons.unit_id اللي بيعملهم supabase_catalog_units.sql،
-- فشغّله الأول (وقبله supabase_catalog_subjects_link.sql). لو الملف ده لسه ماتشغّلش، اللوحة بتعدّ من الجداول مباشرة (أبطأ).
-- security_invoker: الـ view بتحترم صلاحيات اللي بيقرا. الملف آمن لو اتشغّل أكتر من مرة.
-- ============================================================

create or replace view public.catalog_subject_unit_stats
with (security_invoker = true) as
select
  s.id as subject_id,
  (select count(*) from public.catalog_units u where u.subject_id = s.id)::int as units_count,
  (select count(*) from public.catalog_lessons l where l.subject_id = s.id and l.unit_id is null and l.is_active)::int as no_unit_visible,
  (select count(*) from public.catalog_lessons l where l.subject_id = s.id and l.unit_id is null and not l.is_active)::int as no_unit_hidden
from public.catalog_subjects s;

revoke all on public.catalog_subject_unit_stats from anon;
grant select on public.catalog_subject_unit_stats to authenticated;
