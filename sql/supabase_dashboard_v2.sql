-- ============================================
-- طالب علم — لوحة التحكم v2: تحديثات قاعدة البيانات
-- شغّل الكود ده في: Supabase Dashboard → SQL Editor → New Query → Run
-- (بعد كل ملفات SQL السابقة: setup, forum, admin, moderation, features)
-- ============================================

-- 1) تخزين إيميل كل طالب في profiles (مطلوب عشان لوحة التحكم تقدر تبعت
--    رابط تغيير كلمة مرور من غير ما تحتاج صلاحيات service_role الخطيرة)
alter table public.profiles add column if not exists email text;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$ language plpgsql security definer;

-- تعبئة الإيميلات للحسابات الموجودة فعلاً قبل التحديث ده
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- 2) استهداف الرسالة العامة لصف/نظام معين (لو سايبها فاضية = تظهر للكل)
alter table public.announcements add column if not exists target_system text;
alter table public.announcements add column if not exists target_grade text;

-- 3) فهارس لتسريع الفلترة والبحث في لوحة التحكم
create index if not exists idx_forum_threads_grade on public.forum_threads(grade);
create index if not exists idx_forum_threads_created on public.forum_threads(created_at desc);
create index if not exists idx_forum_reports_status on public.forum_reports(status);
create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_banned on public.profiles(banned);
create index if not exists idx_user_stats_hours on public.user_stats(total_study_hours desc);
