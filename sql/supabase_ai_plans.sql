-- ============================================================
-- المساعد الذكي (بو): خطط واشتراكات + سجل التكلفة
-- شغّله مرة واحدة في: Supabase Dashboard → SQL Editor → New Query → Run
-- ------------------------------------------------------------
-- الفكرة: الدخل من الاشتراكات يغطي موديلات مدفوعة وترقية Supabase والنشر على جوجل بلاي.
--   ai_plans          الخطط: حد يومي، مدة، سعر للعرض، موديلات خاصة بالخطة (اختياري)
--   ai_subscriptions  اشتراك الطالب في خطة (الأدمن بيفعّله يدوي من اللوحة بعد الدفع)
--   ai_usage_events   لكل رد ناجح: الموديل وعدد التوكنز (من غير أي محتوى) — عشان نعرف التكلفة الحقيقية (بتتحفظ ٤٠٠ يوم)
--
-- القواعد اللي الدالة ai-assistant بتطبقها:
--   - الاشتراك الفعّال بيفعّل بو للطالب حتى لو ai_access.enabled = false، وبينتهي لوحده عند ends_at
--   - الحد اليومي: لو فيه خطة = الأكبر بين حد الخطة والتخصيص الفردي، وإلا التخصيص الفردي أو الافتراضي
--   - المشتركين مبيتأثروش بالسقف الشهري العام (monthly_limit_global)
--   - موديلات الخطة (لو متحددة) بتتجرّب الأول، وبعدها السلسلة العامة كاحتياطي
--   - لو للطالب أكتر من اشتراك فعّال: بتتطبّق الخطة صاحبة أكبر حد يومي
-- الملف آمن لو اتشغّل أكتر من مرة. بيعتمد على public.is_admin().
-- ============================================================

create table if not exists public.ai_plans (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (description is null or char_length(description) <= 200),
  daily_limit int not null check (daily_limit between 1 and 1000),
  duration_days int check (duration_days is null or duration_days between 1 and 3660), -- null = بدون مدة
  price_egp numeric(10, 2) check (price_egp is null or price_egp >= 0),                 -- للعرض بس (جنيه مصري)
  models text[] not null default '{}',   -- موديلات خاصة بالخطة بالترتيب. فاضية = السلسلة العامة
  is_active boolean not null default true, -- false = مخفية من قايمة الخطط عند الطلاب (المشتركين الحاليين مبيتأثروش)
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id bigint not null references public.ai_plans(id) on delete restrict,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,                   -- null = مفتوح. لو فاضي والخطة ليها مدة بيتحسب تلقائيًا (trigger)
  status text not null default 'active' check (status in ('active', 'cancelled')),
  amount_paid numeric(10, 2) check (amount_paid is null or amount_paid >= 0),
  payment_note text check (payment_note is null or char_length(payment_note) <= 300),
  activated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists ai_subscriptions_user_idx on public.ai_subscriptions (user_id, status, ends_at);
create index if not exists ai_subscriptions_ends_idx on public.ai_subscriptions (ends_at) where status = 'active';

create table if not exists public.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  plan_id bigint references public.ai_plans(id) on delete set null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,     -- شامل توكنز التفكير لو الموديل بيستخدمها
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_created_idx on public.ai_usage_events (created_at desc);
create index if not exists ai_usage_events_model_idx on public.ai_usage_events (model, created_at desc);

-- تحديث updated_at للخطة بتوقيت السيرفر
create or replace function public.ai_plans_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ai_plans_touch_trigger on public.ai_plans;
create trigger ai_plans_touch_trigger
  before update on public.ai_plans
  for each row execute function public.ai_plans_touch();

-- نهاية الاشتراك بتتحسب من مدة الخطة لو الأدمن مخلهاش فاضية، وتاريخ الإلغاء بيتسجّل لوحده
create or replace function public.ai_subscriptions_fill()
returns trigger language plpgsql as $$
declare
  days int;
begin
  if tg_op = 'INSERT' and new.ends_at is null then
    select duration_days into days from public.ai_plans where id = new.plan_id;
    if days is not null then
      new.ends_at := new.starts_at + make_interval(days => days);
    end if;
  end if;
  if new.ends_at is not null and new.ends_at <= new.starts_at then
    raise exception 'نهاية الاشتراك لازم تكون بعد بدايته';
  end if;
  if new.status = 'cancelled' and new.cancelled_at is null then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists ai_subscriptions_fill_trigger on public.ai_subscriptions;
create trigger ai_subscriptions_fill_trigger
  before insert or update on public.ai_subscriptions
  for each row execute function public.ai_subscriptions_fill();

-- الصلاحيات
alter table public.ai_plans enable row level security;
alter table public.ai_subscriptions enable row level security;
alter table public.ai_usage_events enable row level security;

-- الخطط المفعّلة قدّام الكل (التطبيق بيعرضها في شاشة "الخطط")، والأدمن بيعدّل
drop policy if exists "Anyone can read active ai plans" on public.ai_plans;
create policy "Anyone can read active ai plans"
  on public.ai_plans for select
  to anon, authenticated
  using (is_active);

drop policy if exists "Admins manage ai plans" on public.ai_plans;
create policy "Admins manage ai plans"
  on public.ai_plans for all
  using (public.is_admin())
  with check (public.is_admin());

-- الاشتراكات والاستهلاك: الأدمن بس. الدالة بتقرا وتكتب بـ service role (بيتجاوز RLS)
drop policy if exists "Admins manage ai subscriptions" on public.ai_subscriptions;
create policy "Admins manage ai subscriptions"
  on public.ai_subscriptions for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can view ai usage events" on public.ai_usage_events;
create policy "Admins can view ai usage events"
  on public.ai_usage_events for select
  using (public.is_admin());

-- عرض جاهز للوحة: الاشتراكات مع اسم الطالب والخطة والحالة الفعلية
create or replace view public.ai_subscriptions_view
with (security_invoker = true)
as
select
  s.id,
  s.user_id,
  p.name as student_name,
  s.plan_id,
  pl.name as plan_name,
  pl.daily_limit,
  s.starts_at,
  s.ends_at,
  s.status,
  case
    when s.status = 'cancelled' then 'cancelled'
    when s.starts_at > now() then 'scheduled'
    when s.ends_at is not null and s.ends_at <= now() then 'expired'
    else 'active'
  end as effective_status,
  s.amount_paid,
  s.payment_note,
  s.activated_by,
  s.created_at,
  s.cancelled_at
from public.ai_subscriptions s
join public.ai_plans pl on pl.id = s.plan_id
left join public.profiles p on p.id = s.user_id;

-- الدخل الشهري من الاشتراكات (بتوقيت القاهرة)
create or replace view public.ai_revenue_monthly
with (security_invoker = true)
as
select
  to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM') as month,
  count(*) as subscriptions,
  coalesce(sum(amount_paid), 0) as revenue_egp
from public.ai_subscriptions
where status <> 'cancelled' or amount_paid is not null
group by 1;

-- استهلاك التوكنز الشهري لكل موديل (لتقدير التكلفة في اللوحة بسعر المليون توكن)
create or replace view public.ai_token_usage_monthly
with (security_invoker = true)
as
select
  to_char(created_at at time zone 'Africa/Cairo', 'YYYY-MM') as month,
  model,
  count(*) as replies,
  sum(input_tokens)::bigint as input_tokens,
  sum(output_tokens)::bigint as output_tokens
from public.ai_usage_events
group by 1, 2;

-- تنظيف سجل الاستهلاك بعد ٤٠٠ يوم (الصف الواحد صغير جدًا فالحجم مش مشكلة، والمدة بتكفي مقارنة سنة
-- بسنة). الـ view الشهري بيتحسب من الصفوف الموجودة. بيتجدول تلقائيًا لو pg_cron متفعّل.
create or replace function public.ai_usage_events_cleanup()
returns void language sql as $$
  delete from public.ai_usage_events where created_at < now() - interval '400 days';
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ai-usage-events-cleanup';
    perform cron.schedule('ai-usage-events-cleanup', '30 3 * * *', 'select public.ai_usage_events_cleanup()');
  end if;
end;
$$;
