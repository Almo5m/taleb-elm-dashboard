-- ============================================================
-- تفعيل المساعد الذكي تلقائيًا للطلاب الجدد
-- ------------------------------------------------------------
-- بيشتغل لما تفعّل الاختيار "تفعيل المساعد تلقائيًا للطلاب الجدد" من
-- الإعدادات ← المساعد الذكي (auto_enable_new جوه إعداد ai_assistant).
-- أي حساب طالب جديد بيتسجّل له صف في ai_access بـ enabled = true.
--
--   * ينطبق على الحسابات الجديدة بس. الحاليين من صفحة الحسابات (تحديد ← تفعيل).
--   * لو الاختيار مقفول، الـ trigger مابيعملش حاجة.
--   * مايوقّفش تسجيل أي طالب أبدًا: أي خطأ جوه الدالة بيتجاهل.
--   * لو الطالب اتعطّل له المساعد بعد كده، مش بيتفعّل تاني (الـ trigger على الإنشاء بس).
--
-- الملف آمن لو اتشغّل أكتر من مرة.
-- ============================================================

create or replace function public.auto_enable_ai_for_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auto boolean;
begin
  if coalesce(NEW.role, 'student') <> 'student' then
    return NEW;
  end if;

  select coalesce((value->>'auto_enable_new')::boolean, false)
    into v_auto
  from public.app_settings
  where key = 'ai_assistant';

  if coalesce(v_auto, false) then
    insert into public.ai_access (user_id, enabled)
    values (NEW.id, true)
    on conflict (user_id) do nothing;
  end if;

  return NEW;
exception when others then
  raise warning 'auto_enable_ai_for_new_profile: %', sqlerrm;
  return NEW;
end;
$$;

revoke execute on function public.auto_enable_ai_for_new_profile() from public, anon, authenticated;

drop trigger if exists trg_auto_enable_ai_new_profile on public.profiles;
create trigger trg_auto_enable_ai_new_profile
  after insert on public.profiles
  for each row execute function public.auto_enable_ai_for_new_profile();
