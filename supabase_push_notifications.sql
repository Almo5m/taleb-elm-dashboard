-- ============================================
-- طالب علم — جدول سجل الإشعارات (الواجهة جاهزة، الإرسال الفعلي معلّق
-- لحد ما إعداد Firebase Cloud Messaging يخلص من ناحية التطبيق)
-- ============================================

create table if not exists public.push_notifications_log (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  target_type text not null check (target_type in ('all', 'single_user')),
  target_user_id uuid references auth.users(id) on delete set null,
  sent_by_admin_id uuid,
  sent_by_admin_name text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error_message text,
  sent_at timestamptz not null default now()
);

create index if not exists push_notifications_log_sent_at_idx on public.push_notifications_log(sent_at desc);

alter table public.push_notifications_log enable row level security;

drop policy if exists "Admins can view push_notifications_log" on public.push_notifications_log;
create policy "Admins can view push_notifications_log"
  on public.push_notifications_log for select
  using (public.is_admin());

drop policy if exists "Admins can insert push_notifications_log" on public.push_notifications_log;
create policy "Admins can insert push_notifications_log"
  on public.push_notifications_log for insert
  with check (public.is_admin());
