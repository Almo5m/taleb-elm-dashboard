-- ============================================
-- طالب علم — 🔴 إصلاح أمني حرج: منع تصعيد الصلاحيات
-- شغّل الكود ده فورًا، قبل أي حاجة تانية
-- ============================================
--
-- المشكلة: policy "Users can update own profile" (UPDATE on public.profiles)
-- شرطها بس (auth.uid() = id) من غير WITH CHECK، يعني أي مستخدم عادي يقدر
-- يبعت طلب UPDATE على صفه هو ويغيّر أي عمود فيه — بما فيها role (يرقّي
-- نفسه admin) و banned (يفك الحظر عن نفسه).
--
-- الحل: trigger بيتأكد إن عمود role وعمود banned متغيّرش إلا لو اللي بيعمل
-- التعديل أدمن فعلاً بالأساس. لو حد غير أدمن حاول يغيّرهم، الـ trigger
-- بيرجّع القيمة القديمة تلقائيًا (من غير ما يفشل الطلب أو يكسر تحديثات
-- عادية زي تغيير الاسم/الصورة).

create or replace function public.prevent_profile_self_escalation()
returns trigger as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role then
      new.role := old.role;
    end if;
    if new.banned is distinct from old.banned then
      new.banned := old.banned;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists prevent_profile_self_escalation_trigger on public.profiles;
create trigger prevent_profile_self_escalation_trigger
  before update on public.profiles
  for each row execute function public.prevent_profile_self_escalation();
