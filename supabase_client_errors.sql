-- ============================================
-- طالب علم — تقارير الأعطال المجهولة من التطبيق (client_errors)
-- شغّله في: Supabase Dashboard → SQL Editor → New Query → Run
-- التطبيق (lib/services/error_reporter.dart) بيبعت صف لكل خطأ غير متوقع.
-- مفيش اسم ولا إيميل ولا user_id — بس device_id عشوائي بيتولّد على الجهاز.
-- الأدمن بس هو اللي يقدر يقرا الجدول.
-- ============================================

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_id text not null,
  app_version text,
  platform text,
  context text,
  message text,
  stack text
);

create index if not exists client_errors_created_idx on public.client_errors(created_at desc);
create index if not exists client_errors_device_idx on public.client_errors(device_id, created_at desc);

alter table public.client_errors enable row level security;

-- الإدخال مسموح للضيف والمسجّل (الأعطال بتحصل في الحالتين)، بحدود طول صارمة
drop policy if exists "Anyone can report errors" on public.client_errors;
create policy "Anyone can report errors"
  on public.client_errors for insert
  to anon, authenticated
  with check (
    char_length(device_id) <= 64
    and char_length(coalesce(app_version, '')) <= 32
    and char_length(coalesce(platform, '')) <= 32
    and char_length(coalesce(context, '')) <= 64
    and char_length(coalesce(message, '')) <= 600
    and char_length(coalesce(stack, '')) <= 2500
  );

drop policy if exists "Admins can read errors" on public.client_errors;
create policy "Admins can read errors"
  on public.client_errors for select
  using (public.is_admin());

drop policy if exists "Admins can delete errors" on public.client_errors;
create policy "Admins can delete errors"
  on public.client_errors for delete
  using (public.is_admin());

-- حماية من الإغراق: 30 تقرير/ساعة لكل جهاز، و3000 تقرير/ساعة إجمالًا.
-- (device_id بيتولّد على الجهاز فممكن يتزوّر — الحد الإجمالي هو شبكة الأمان الحقيقية)
create or replace function public.limit_client_errors()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  per_device int;
  total int;
begin
  select count(*) into per_device from public.client_errors
  where device_id = new.device_id and created_at > now() - interval '1 hour';
  if per_device >= 30 then
    raise exception 'RATE_LIMIT: too many error reports';
  end if;

  select count(*) into total from public.client_errors
  where created_at > now() - interval '1 hour';
  if total >= 3000 then
    raise exception 'RATE_LIMIT: global error report cap';
  end if;

  return new;
end;
$$;

drop trigger if exists client_errors_limit_trigger on public.client_errors;
create trigger client_errors_limit_trigger
  before insert on public.client_errors
  for each row execute function public.limit_client_errors();

-- تنظيف تلقائي (اختياري): امسح التقارير الأقدم من 30 يوم
--   delete from public.client_errors where created_at < now() - interval '30 days';
-- (الجدولة التلقائية الجاهزة في supabase_client_errors_alert.sql)
