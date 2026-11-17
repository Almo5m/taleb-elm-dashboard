-- ============================================================
-- دروس المنهج: عدّادات الدروس لكل مادة (للوحة)
-- ------------------------------------------------------------
-- صفحة "دروس المنهج" محتاجة تعرف لكل مادة كام درس ظاهر وكام مخفي، ولكارت "تغطية المنهج".
-- حساب ده في المتصفح معناه تحميل كل الدروس (ممكن عشرات الآلاف)، فالعدّ بيتم هنا في view واحدة.
--
-- security_invoker: الـ view بتحترم صلاحيات اللي بيقرا (القراءة بتاعة catalog_lessons مفتوحة أصلًا).
-- بتتبني على الجدول اللي بيعمله supabase_catalog_lessons.sql، فشغّله الأول.
-- لو الملف ده لسه ماتشغّلش، الصفحة بتعدّ من الدروس مباشرة (أبطأ لما الدروس تكتر).
-- الملف آمن لو اتشغّل أكتر من مرة.
-- ============================================================

create or replace view public.catalog_subject_stats
with (security_invoker = true) as
select
  subject_id,
  (count(*) filter (where is_active))::int as visible_count,
  (count(*) filter (where not is_active))::int as hidden_count
from public.catalog_lessons
group by subject_id;

revoke all on public.catalog_subject_stats from anon;
grant select on public.catalog_subject_stats to authenticated;
