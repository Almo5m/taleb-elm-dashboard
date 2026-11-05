-- ============================================
-- طالب علم — إصلاح: إشعار "طالب جديد" كان بيتبعت وقت إنشاء الصف المبدئي
-- في profiles (id + email بس، الاسم لسه فاضي)، عشان كده كان بيوصل من غير
-- اسم. دلوقتي هيتبعت لما الطالب فعليًا يحط اسمه (يخلّص التسجيل) بدل كده.
-- ============================================

-- نشيل التريجر القديم اللي بيتبعت على INSERT في profiles (من غير اسم)
drop trigger if exists trg_notify_telegram_insert_profiles on public.profiles;

-- تريجر جديد بيتبعت بس لما الاسم يتغيّر من فاضي لحاجة فعلية (يعني إكمال
-- التسجيل)، مش على أي تعديل تاني في البروفايل (صورة، صف دراسي...)
drop trigger if exists trg_notify_telegram_signup_complete_profiles on public.profiles;
create trigger trg_notify_telegram_signup_complete_profiles
  after update on public.profiles
  for each row
  when (old.name is null and new.name is not null)
  execute function public.notify_telegram_trigger();
