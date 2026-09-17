-- ============================================
-- طالب علم — جدول الإيميلات (فردي/صف/الكل)، مع دعم الجدولة
-- شغّله مرة واحدة في Supabase SQL Editor
-- ============================================

create table if not exists public.scheduled_emails (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  body text not null,
  target_type text not null check (target_type in ('all', 'grade', 'single_user')),
  target_grade text,
  target_user_id uuid references auth.users(id) on delete set null,
  scheduled_at timestamptz, -- فاضي = يتبعت فورًا
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  sent_count int not null default 0,
  failed_count int not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists scheduled_emails_status_scheduled_idx
  on public.scheduled_emails(status, scheduled_at);

alter table public.scheduled_emails enable row level security;

drop policy if exists "Admins can view scheduled_emails" on public.scheduled_emails;
create policy "Admins can view scheduled_emails"
  on public.scheduled_emails for select
  using (public.is_admin());

-- ==========================================================
-- جدولة معالجة الإيميلات المستحقة — كل 5 دقايق
-- ==========================================================
-- ⚠️ عدّل نفس القيم المعتادة (الرابط، anon key، webhook secret) قبل التشغيل
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'process_scheduled_emails',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://urpzmcvftooacnnwdpqn.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ضع_مفتاح_anon_القديم_هنا',
      'x-webhook-secret', 'taleb-elm-webhook-9f3a7c2e1b'
    ),
    body := '{"mode": "process_due"}'::jsonb
  );
  $$
);
