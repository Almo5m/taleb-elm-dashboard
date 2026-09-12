-- ============================================
-- طالب علم — تحسينات: سجل أسئلة الطلاب + إشعارات تليجرام
-- شغّل الكود ده في: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================

-- ==========================================================
-- 1) سجل أسئلة الطلاب لمساعد الـ AI (بو)
-- ==========================================================
-- بنخزّن سؤال الطالب بس (مش رد الـ AI) عشان تقدر تراجع هل الاستخدام
-- في المنهج ولا لأ. الوصول للجدول ده أدمن بس، ومحتفظين بيه لمدة 60 يوم
-- بس عن طريق job يومي بيمسح الأقدم من كده تلقائيًا.

create table if not exists public.ai_chat_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_chat_logs_user_id_idx on public.ai_chat_logs(user_id);
create index if not exists ai_chat_logs_created_at_idx on public.ai_chat_logs(created_at);

alter table public.ai_chat_logs enable row level security;

drop policy if exists "Admins can view ai_chat_logs" on public.ai_chat_logs;
create policy "Admins can view ai_chat_logs"
  on public.ai_chat_logs for select
  using (public.is_admin());

-- مفيش policy للكتابة — التسجيل هيحصل من Edge Function بالـ service role بس.

-- تنظيف تلقائي يومي: مسح أي سؤال أقدم من 60 يوم
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'ai_chat_logs_cleanup',
  '0 3 * * *', -- كل يوم الساعة 3 فجرًا
  $$delete from public.ai_chat_logs where created_at < now() - interval '60 days'$$
);

-- ==========================================================
-- 2) إشعارات تليجرام على الأحداث المهمة بس
-- ==========================================================
-- بنستخدم Database Webhooks (مبنية جوه Supabase أصلاً) عشان تنادي Edge
-- Function اسمها telegram-notify مع كل حدث. المستثنى عمدًا: ai_usage_daily/
-- monthly, user_stats, study_plan_tasks — بتتغير بكثرة ومالهاش قيمة كإشعار.
--
-- ⚠️ عدّل الأسطر التلاتة تحت (url و Authorization و x-webhook-secret) بقيمك
-- الحقيقية قبل التشغيل — بس خلي بالك متسيبش علامتي < > حوالين القيمة،
-- وخد الـ anon key من تبويب "Legacy anon, service_role API keys"
-- (بيبدأ بـ eyJ...) مش من تبويب المفاتيح الجديدة (sb_publishable_...)

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_telegram(table_name text, event_type text, row_data jsonb)
returns void as $$
begin
  perform net.http_post(
    url := 'https://urpzmcvftooacnnwdpqn.supabase.co/functions/v1/telegram-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ضع_مفتاح_anon_القديم_هنا',
      'x-webhook-secret', 'taleb-elm-webhook-9f3a7c2e1b'
    ),
    body := jsonb_build_object('table', table_name, 'event', event_type, 'record', row_data)
  );
end;
$$ language plpgsql security definer;

-- دالة واحدة مشتركة بتتنادى من أي trigger، وبتاخد اسم الجدول ونوع الحدث
-- وبيانات الصف نفسه تلقائيًا من TG_TABLE_NAME و TG_OP و NEW/OLD
create or replace function public.notify_telegram_trigger()
returns trigger as $$
begin
  perform public.notify_telegram(
    TG_TABLE_NAME,
    TG_OP,
    to_jsonb(coalesce(NEW, OLD))
  );
  return coalesce(NEW, OLD);
end;
$$ language plpgsql security definer;

do $$
declare
  t record;
  triggers_config jsonb := '[
    {"table_name": "profiles", "event": "INSERT"},
    {"table_name": "forum_threads", "event": "INSERT"},
    {"table_name": "forum_replies", "event": "INSERT"},
    {"table_name": "forum_reports", "event": "INSERT"},
    {"table_name": "banned_words", "event": "INSERT"},
    {"table_name": "banned_words", "event": "DELETE"},
    {"table_name": "announcements", "event": "INSERT"},
    {"table_name": "admin_audit_log", "event": "INSERT"},
    {"table_name": "ai_access", "event": "UPDATE"},
    {"table_name": "app_settings", "event": "UPDATE"}
  ]'::jsonb;
begin
  for t in select * from jsonb_to_recordset(triggers_config) as x(table_name text, event text) loop
    if to_regclass('public.' || t.table_name) is not null then
      execute format(
        'drop trigger if exists trg_notify_telegram_%s_%s on public.%I',
        lower(t.event), t.table_name, t.table_name
      );
      execute format(
        'create trigger trg_notify_telegram_%s_%s after %s on public.%I
         for each row execute function public.notify_telegram_trigger()',
        lower(t.event), t.table_name, t.event, t.table_name
      );
    else
      raise notice 'تجاهلت جدول غير موجود (تليجرام): %', t.table_name;
    end if;
  end loop;
end $$;
