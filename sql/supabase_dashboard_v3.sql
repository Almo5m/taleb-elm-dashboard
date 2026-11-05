-- ============================================
-- طالب علم — لوحة التحكم v3: تحديثات قاعدة البيانات
-- شغّل الكود ده في: Supabase Dashboard → SQL Editor → New Query → Run
-- (بعد كل ملفات SQL السابقة، وبعد supabase_dashboard_v2.sql تحديدًا)
-- ============================================

-- ============================================
-- 1) صلاحيات متدرجة: مشرف (moderator) بجانب الأدمن الكامل
-- ============================================
-- role في profiles ممكن دلوقتي تكون: 'student' / 'moderator' / 'admin'
-- is_admin()  → أدمن كامل بس (إدارة الحسابات، الترقية، الإعدادات العامة)
-- is_staff()  → أدمن أو مشرف (إدارة المنتدى والبلاغات)

create or replace function public.is_staff()
returns boolean as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'moderator')
  );
$$ language sql security definer stable;

-- المشرف يقدر يشوف الحسابات (قراءة فقط، مش تعديل ولا حظر ولا ترقية) — مفيد
-- عشان يعرف صاحب أي سؤال أو رد وهو بيراجع المنتدى والبلاغات
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Staff can view all profiles"
  on public.profiles for select
  using (public.is_staff());
-- التعديل والحظر والترقية لسه أدمن كامل بس (السياسة "Admins can update all profiles" زي ما هي)

-- تحديث سياسات حذف المنتدى عشان تشمل المشرف مش الأدمن الكامل بس
drop policy if exists "Admins can delete any thread" on public.forum_threads;
create policy "Staff can delete any thread"
  on public.forum_threads for delete
  using (public.is_staff());

drop policy if exists "Admins can delete any reply" on public.forum_replies;
create policy "Staff can delete any reply"
  on public.forum_replies for delete
  using (public.is_staff());

-- تحديث سياسات البلاغات عشان المشرف يقدر يراجعها (مش يحذفها نهائي غير الأدمن الكامل)
drop policy if exists "Admins can view reports" on public.forum_reports;
create policy "Staff can view reports"
  on public.forum_reports for select
  using (public.is_staff());

drop policy if exists "Admins can update reports" on public.forum_reports;
create policy "Staff can update reports"
  on public.forum_reports for update
  using (public.is_staff());

drop policy if exists "Admins can delete reports" on public.forum_reports;
create policy "Admins can delete reports"
  on public.forum_reports for delete
  using (public.is_admin());

-- ============================================
-- 2) سجل نشاط الأدمن (Audit Log)
-- ============================================
create table if not exists public.admin_audit_log (
  id uuid default gen_random_uuid() primary key,
  admin_id uuid references auth.users on delete set null,
  admin_name text,
  action text not null,          -- 'ban' / 'unban' / 'promote' / 'demote' / 'delete_thread' / ...
  target_type text not null,     -- 'profile' / 'thread' / 'reply' / 'report' / 'announcement' / ...
  target_id text,
  details text,                  -- وصف مختصر قابل للقراءة
  created_at timestamptz default now()
);

alter table public.admin_audit_log enable row level security;

create policy "Staff can insert own audit entries"
  on public.admin_audit_log for insert
  to authenticated
  with check (public.is_staff() and auth.uid() = admin_id);

create policy "Admins can view audit log"
  on public.admin_audit_log for select
  using (public.is_admin());

create index if not exists idx_audit_log_created on public.admin_audit_log(created_at desc);

-- ============================================
-- 3) رسائل عامة مجدولة (بداية/نهاية تلقائية)
-- ============================================
alter table public.announcements add column if not exists starts_at timestamptz;
alter table public.announcements add column if not exists ends_at timestamptz;

-- يتطلب تفعيل extension اسمه pg_cron مرة واحدة من:
-- Supabase Dashboard → Database → Extensions → ابحث عن pg_cron → Enable
-- لو مش عايز تفعّله، الرسائل هتفضل شغالة زي ما هي (active يدوي) بدون جدولة تلقائية،
-- والباقي كله (كل التحكمات التانية في الملف ده) هيشتغل عادي من غيره.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'announcements-auto-expire',
      '*/5 * * * *',
      $cron$
        update public.announcements set active = false
        where active = true and ends_at is not null and ends_at < now();
        update public.announcements set active = true
        where active = false and starts_at is not null and starts_at <= now()
          and (ends_at is null or ends_at > now());
      $cron$
    );
  end if;
exception when others then
  null; -- لو pg_cron مش متاح أو الجدولة موجودة بالفعل، تجاهل بهدوء
end $$;

-- ============================================
-- 4) جدول إعدادات عامة للتطبيق (مفتاح/قيمة) — للتحكم في محتوى
--    كان قبل كده ثابت جوه كود التطبيق (رسائل تحفيزية، روابط تواصل،
--    وضع الصيانة، أقل إصدار مسموح). التطبيق محتاج تعديل ليقرأ منه (مواصفات منفصلة).
-- ============================================
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

alter table public.app_settings enable row level security;

create policy "Everyone can read app settings"
  on public.app_settings for select
  using (true);

create policy "Admins can manage app settings"
  on public.app_settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- قيم مبدئية (تقدر تعدّلها لاحقًا من لوحة التحكم)
insert into public.app_settings (key, value) values
  ('maintenance', '{"enabled": false, "message": ""}'),
  ('min_app_version', '{"android": "1.0.0"}'),
  ('contact_links', '{
    "whatsapp": "https://wa.me/201550036259",
    "email": "mailto:moaz2009amen@gmail.com",
    "instagram": "https://instagram.com/moaz_amen5",
    "facebook": "https://www.facebook.com/profile.php?id=61552026802548",
    "telegram_group": "https://t.me/monaksha_3",
    "telegram_channel": "https://t.me/Tanawy_3_offical",
    "telegram_personal": "https://t.me/Almoo5m"
  }'),
  ('focus_messages', '[]')
on conflict (key) do nothing;

-- ============================================
-- 5) فلتر كلمات ممنوعة تلقائي في المنتدى
-- ============================================
create table if not exists public.banned_words (
  id uuid default gen_random_uuid() primary key,
  word text not null unique,
  created_at timestamptz default now()
);

alter table public.banned_words enable row level security;

create policy "Admins can manage banned words"
  on public.banned_words for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.check_banned_words()
returns trigger as $$
declare
  bad text;
  haystack text;
begin
  haystack := lower(coalesce(new.title, '') || ' ' || coalesce(new.body, ''));
  select word into bad from public.banned_words
  where haystack like '%' || lower(word) || '%'
  limit 1;

  if bad is not null then
    raise exception 'BLOCKED_WORD: المحتوى ده فيه كلمة غير مسموح بيها، عدّل النص وحاول تاني';
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists thread_banned_words_trigger on public.forum_threads;
create trigger thread_banned_words_trigger
  before insert or update on public.forum_threads
  for each row execute function public.check_banned_words();

-- نفس الفلتر على الردود (بيستخدم عمود body بس، مفيش title في forum_replies)
create or replace function public.check_banned_words_reply()
returns trigger as $$
declare
  bad text;
  haystack text;
begin
  haystack := lower(coalesce(new.body, ''));
  select word into bad from public.banned_words
  where haystack like '%' || lower(word) || '%'
  limit 1;

  if bad is not null then
    raise exception 'BLOCKED_WORD: الرد ده فيه كلمة غير مسموح بيها، عدّل النص وحاول تاني';
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists reply_banned_words_trigger on public.forum_replies;
create trigger reply_banned_words_trigger
  before insert or update on public.forum_replies
  for each row execute function public.check_banned_words_reply();
