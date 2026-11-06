-- ============================================================
-- حارس user_stats: كشف (وبعدين منع) القيم المستحيلة في أرقام المتصدرين
-- ------------------------------------------------------------
-- المشكلة: policy "Users can update own stats" بتسمح للطالب يكتب أي رقم في صفه
-- (ساعات مذاكرة، streak، إنجازات)، وده بيغش في المتصدرين.
--
-- التصميم راعى إن التطبيق أوفلاين وإن الأرقام بتتحسب جواه وتتبعت كإجمالي:
--   * مفيش أي حساب بالوقت على السيرفر (لا فرق وقت بين كتابتين، ولا عمر الحساب).
--     السبب: التسجيل اليدوي لجلسات قديمة، ووضع الضيف قبل التسجيل، والمزامنة المتأخرة
--     كلها بتخلّي القفزات الكبيرة مشروعة.
--   * بيراجع كل كتابة جاية من طالب (auth.uid() موجود). السيرفر وSQL Editor مش بيتدخل فيهم.
--
-- نوعين من القواعد:
--   1) "مستحيل" (بيتسجّل، وفي وضع clamp بيتصحّح):
--      - قيمة سالبة
--      - ساعات مذاكرة > 15000 أو streak > 2000
--      - إنجازات أكتر من اللي الأرقام نفسها بتسمح بيه (من جدول achievements_catalog:
--        إنجازات الساعات والـ streak بتتحسب من القيم المبعوتة، وباقي الأنواع بعددها الكلي)
--      - اسم أطول من 100 حرف أو رابط صورة أطول من 1000
--      التصحيح: القيمة المستحيلة بترجع لقيمتها القديمة (أو 0 للصف الجديد)، والإنجازات للحد المسموح.
--   2) "مراقبة" (بتتسجّل بس، عمرها ما بتتغيّر): ساعات > 2000، أو قفزة > 200 ساعة في كتابة واحدة.
--      دي ممكن تكون مشروعة (طالب مجتهد، أو ضيف سجّل بعد شهور)، فبتتراجع بإيدك.
--
-- وضعين (من جدول user_stats_guard_config، بتغيّره من SQL Editor بس):
--   'log'   (الافتراضي) بيسجّل في user_stats_flags ومابيغيّرش أي قيمة.
--   'clamp' بيسجّل ويصحّح قواعد "المستحيل" بس. مابيرميش أخطاء، فالتطبيق مش هيتأثر.
--
-- حد الحل: القيم "المعقولة" (زي 1500 ساعة) هتعدّي، لأن السيرفر مايقدرش يثبت إن الجلسات حقيقية.
-- بتتكشف بالمراجعة (قواعد المراقبة) مش بالمنع.
--
-- الملف آمن لو اتشغّل أكتر من مرة. مش بيغيّر policies الكتابة.
-- ============================================================

-- 1) إعداد الوضع (صف واحد بس، مفيش وصول من الـ API)
create table if not exists public.user_stats_guard_config (
  id boolean primary key default true check (id),
  mode text not null default 'log' check (mode in ('log', 'clamp'))
);
insert into public.user_stats_guard_config (id, mode) values (true, 'log')
  on conflict (id) do nothing;
alter table public.user_stats_guard_config enable row level security;
revoke all on public.user_stats_guard_config from anon, authenticated;

-- 2) سجل المخالفات (الأدمن بس يقرأ، والكتابة من الـ trigger بس)
create table if not exists public.user_stats_flags (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null,
  reason text not null,
  old_values jsonb,
  new_values jsonb,
  clamped boolean not null default false
);
create index if not exists user_stats_flags_created_idx on public.user_stats_flags (created_at desc);
create index if not exists user_stats_flags_user_idx on public.user_stats_flags (user_id, reason, created_at desc);

alter table public.user_stats_flags enable row level security;
drop policy if exists "Admins can read user_stats_flags" on public.user_stats_flags;
create policy "Admins can read user_stats_flags"
  on public.user_stats_flags for select
  to authenticated
  using (public.is_admin());
revoke all on public.user_stats_flags from anon;
revoke insert, update, delete, truncate on public.user_stats_flags from authenticated;

-- 3) الحارس نفسه
create or replace function public.guard_user_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- حدود "مستحيل"
  c_max_hours   constant numeric := 15000;
  c_max_streak  constant int     := 2000;
  c_max_name    constant int     := 100;
  c_max_avatar  constant int     := 1000;
  c_fallback_ach constant int    := 200;   -- لو جدول achievements_catalog مش موجود
  -- حدود "مراقبة"
  c_watch_hours constant numeric := 2000;
  c_watch_jump  constant numeric := 200;

  v_mode       text;
  v_old        jsonb;
  v_new        jsonb;
  v_reasons    text[] := '{}';
  v_reason     text;
  v_old_hours  numeric;
  v_old_streak int;
  v_old_ach    int;
  v_ach_cap    int;
  v_clamp      boolean;
begin
  -- طلبات السيرفر (SQL Editor / service_role) مالهاش auth.uid(): مش بنتدخل
  if auth.uid() is null then
    return NEW;
  end if;

  begin
    select mode into v_mode from public.user_stats_guard_config where id;
    v_clamp := coalesce(v_mode, 'log') = 'clamp';

    v_new := to_jsonb(NEW);
    v_old := case when tg_op = 'UPDATE' then to_jsonb(OLD) else null end;

    v_old_hours  := case when tg_op = 'UPDATE' then coalesce(OLD.total_study_hours, 0) else 0 end;
    v_old_streak := case when tg_op = 'UPDATE' then coalesce(OLD.current_streak, 0) else 0 end;
    v_old_ach    := case when tg_op = 'UPDATE' then coalesce(OLD.achievements_count, 0) else 0 end;

    -- ساعات المذاكرة
    if NEW.total_study_hours is not null then
      if NEW.total_study_hours < 0 then
        v_reasons := array_append(v_reasons, 'negative_hours'::text);
        if v_clamp then NEW.total_study_hours := v_old_hours; end if;
      elsif NEW.total_study_hours > c_max_hours then
        v_reasons := array_append(v_reasons, 'hours_impossible'::text);
        if v_clamp then NEW.total_study_hours := least(v_old_hours, c_max_hours); end if;
      else
        if NEW.total_study_hours > c_watch_hours then
          v_reasons := array_append(v_reasons, 'hours_very_high'::text);
        end if;
        if NEW.total_study_hours - v_old_hours > c_watch_jump then
          v_reasons := array_append(v_reasons, 'hours_big_jump'::text);
        end if;
      end if;
    end if;

    -- الاستمرارية (streak)
    if NEW.current_streak is not null then
      if NEW.current_streak < 0 then
        v_reasons := array_append(v_reasons, 'negative_streak'::text);
        if v_clamp then NEW.current_streak := v_old_streak; end if;
      elsif NEW.current_streak > c_max_streak then
        v_reasons := array_append(v_reasons, 'streak_impossible'::text);
        if v_clamp then NEW.current_streak := least(v_old_streak, c_max_streak); end if;
      end if;
    end if;

    -- الإنجازات: الحد الأقصى من الكتالوج وقيم الساعات والـ streak اللي في نفس الكتابة
    if NEW.achievements_count is not null then
      if to_regclass('public.achievements_catalog') is not null then
        select count(*) filter (where metric = 'study_hours' and threshold <= greatest(coalesce(NEW.total_study_hours, 0), 0))
             + count(*) filter (where metric = 'streak' and threshold <= greatest(coalesce(NEW.current_streak, 0), 0))
             + count(*) filter (where metric not in ('study_hours', 'streak'))
          into v_ach_cap
        from public.achievements_catalog;
      else
        v_ach_cap := c_fallback_ach;
      end if;

      if NEW.achievements_count < 0 then
        v_reasons := array_append(v_reasons, 'negative_achievements'::text);
        if v_clamp then NEW.achievements_count := v_old_ach; end if;
      elsif NEW.achievements_count > v_ach_cap then
        v_reasons := array_append(v_reasons, 'achievements_impossible'::text);
        if v_clamp then NEW.achievements_count := v_ach_cap; end if;
      end if;
    end if;

    -- نصوص طويلة
    if char_length(coalesce(NEW.display_name, '')) > c_max_name then
      v_reasons := array_append(v_reasons, 'display_name_too_long'::text);
      if v_clamp then NEW.display_name := left(NEW.display_name, c_max_name); end if;
    end if;
    if char_length(coalesce(NEW.avatar_url, '')) > c_max_avatar then
      v_reasons := array_append(v_reasons, 'avatar_url_too_long'::text);
      if v_clamp then NEW.avatar_url := left(NEW.avatar_url, c_max_avatar); end if;
    end if;

    -- التسجيل: قواعد المراقبة مرة في اليوم لكل طالب، والباقي مرة في الساعة
    -- (عشان المزامنة عند كل فتح للتطبيق ماتغرقش الجدول)
    foreach v_reason in array v_reasons loop
      if not exists (
        select 1 from public.user_stats_flags f
        where f.user_id = NEW.user_id and f.reason = v_reason
          and f.created_at > now() - case when v_reason in ('hours_very_high', 'hours_big_jump')
                                          then interval '1 day' else interval '1 hour' end
      ) then
        insert into public.user_stats_flags (user_id, reason, old_values, new_values, clamped)
        values (NEW.user_id, v_reason, v_old, v_new,
                v_clamp and v_reason not in ('hours_very_high', 'hours_big_jump'));
      end if;
    end loop;

  exception when others then
    -- الحارس عمره ما يوقّف مزامنة طالب عادي: لو حصل أي خطأ فيه بنكمّل
    raise warning 'guard_user_stats: %', sqlerrm;
  end;

  return NEW;
end;
$$;

revoke execute on function public.guard_user_stats() from public, anon, authenticated;

drop trigger if exists user_stats_guard_trigger on public.user_stats;
create trigger user_stats_guard_trigger
  before insert or update on public.user_stats
  for each row execute function public.guard_user_stats();

-- 4) تنظيف السجل (90 يوم) + سحب صلاحيات مالهاش لازمة من authenticated
select cron.schedule(
  'user_stats_flags_cleanup',
  '0 3 * * 0',
  $cron$delete from public.user_stats_flags where created_at < now() - interval '90 days'$cron$
);

revoke truncate, references, trigger on public.user_stats from authenticated;

-- ============================================================
-- مراجعة المخالفات (شغّلها بعد أسبوع):
--   select created_at, user_id, reason, old_values, new_values
--   from public.user_stats_flags order by created_at desc limit 50;
--
-- أعلى الأرقام (للمراجعة اليدوية للمتصدرين):
--   select user_id, display_name, total_study_hours, current_streak, achievements_count
--   from public.user_stats order by total_study_hours desc limit 10;
--
-- لتحويل الحارس لوضع التصحيح (بعد المراجعة):
--   update public.user_stats_guard_config set mode = 'clamp';
-- وللرجوع:
--   update public.user_stats_guard_config set mode = 'log';
--
-- اختبار (استبدل UUID بـ user_id حقيقي من: select user_id from public.user_stats limit 1):
--   begin;
--   select set_config('request.jwt.claims', '{"sub":"UUID","role":"authenticated"}', true);
--   set local role authenticated;
--   update public.user_stats set total_study_hours = 99999 where user_id = 'UUID';
--   reset role;
--   select reason, clamped, new_values->>'total_study_hours' as attempted
--     from public.user_stats_flags order by id desc limit 1;
--   rollback;
-- المتوقع: صف reason = hours_impossible (و clamped = false في وضع log).
-- ============================================================
