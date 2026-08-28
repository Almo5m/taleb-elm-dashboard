-- ============================================
-- طالب علم — مساعد AI مجاني (v2)
-- شغّل الكود ده في: Supabase Dashboard → SQL Editor → New Query → Run
-- (بعد supabase_admin.sql، لأن ده بيستخدم دالة is_admin())
-- ============================================

-- 1) إعدادات المساعد العامة — نفس نمط maintenance/min_app_version الموجود.
-- التطبيق بيقرا المفتاح ده في كل مرة يفتح الشات، فأي تغيير هنا بيبان فورًا
-- من غير تحديث تطبيق.
-- ⚠️ ملاحظة: جدول app_settings مش معرّف في أي ملف SQL موجود في الريبو (يبدو
-- إنه اتعمل يدويًا في البداية)، فمستخدمين "insert ... where not exists" بدل
-- "on conflict" عشان الكود يشتغل بغض النظر عن وجود unique constraint على
-- العمود key من عدمه.
insert into public.app_settings (key, value)
select 'ai_assistant', '{"enabled": false, "daily_limit_per_user": 20, "monthly_limit_global": 3000, "model": "gemini-2.5-flash-lite"}'::jsonb
where not exists (select 1 from public.app_settings where key = 'ai_assistant');

-- 2) عداد الاستخدام اليومي لكل مستخدم
create table if not exists public.ai_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  message_count int not null default 0,
  primary key (user_id, usage_date)
);

alter table public.ai_usage_daily enable row level security;
-- مفيش أي policy مقصودة هنا — يعني التطبيق (بمفتاح anon/المستخدم العادي)
-- مايقدرش يقرا أو يكتب في الجدول ده خالص. كل التعامل معاه من جوه الـ Edge
-- Function بس عن طريق service role اللي بيتجاوز RLS تلقائيًا.

-- 3) عداد الاستخدام الشهري الإجمالي للتطبيق كله (صف واحد لكل شهر)
create table if not exists public.ai_usage_monthly (
  month text primary key, -- بصيغة 'yyyy-MM' زي '2026-08'
  message_count int not null default 0
);

alter table public.ai_usage_monthly enable row level security;
-- برضه مفيش policies — قراءة/كتابة من الـ Edge Function بس.
-- (لوحة التحكم React بتقرا الاستهلاك الشهري عن طريق Edge Function
--  admin-ai-usage اللي بتستخدم service role من السيرفر، مش من الفرونت مباشرة)

-- 4) تحكم فردي لكل طالب — هل مفعّل له الميزة ولاّ لأ (زي اشتراك يدوي)
create table if not exists public.ai_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  daily_limit_override int, -- null = يستخدم الحد العام الافتراضي
  updated_at timestamptz not null default now()
);

alter table public.ai_access enable row level security;

-- الأدمن بس يقدر يقرا/يعدّل — الطالب نفسه مالوش صلاحية مباشرة على الجدول ده
create policy "Admins can view ai_access"
  on public.ai_access for select
  using (public.is_admin());

create policy "Admins can update ai_access"
  on public.ai_access for update
  using (public.is_admin());

create policy "Admins can insert ai_access"
  on public.ai_access for insert
  with check (public.is_admin());
