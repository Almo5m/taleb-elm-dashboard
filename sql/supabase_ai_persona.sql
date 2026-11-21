-- ==========================================================
-- شخصية "بو" ومعرفته بالتطبيق: نسخ محفوظة بتتعدّل من اللوحة (صفحة المساعد الذكي ← الشخصية)
-- ==========================================================
-- ليه جدول منفصل مش app_settings؟ app_settings مقروء لأي مستخدم مسجّل (policy "Everyone can read")،
-- والنص ده وسجل التعديلات مالهمش لازمة يبقوا ظاهرين للطلاب. هنا الأدمن بس.
-- النسخ بتتضاف ومبتتعدّلش ولا بتتمسح من اللوحة (سجل). الرجوع لنسخة قديمة = إضافة نسخة جديدة بنفس النص.
-- الدالة ai-assistant بتقرا أحدث نسخة (وبتخزّنها دقيقة)، ولو مفيش نسخة بتستخدم النص الافتراضي اللي في الكود.
-- حدود الأطوال هنا هي نفس حدود الدالة (٣٠٠٠ و٤٠٠٠) والدالة بتتحقق منهم تاني.
-- شغّله مرة واحدة في Supabase SQL Editor (آمن لو اتشغّل أكتر من مرة).

create table if not exists public.ai_persona_versions (
  id         bigint generated always as identity primary key,
  persona    text not null check (char_length(btrim(persona)) between 1 and 3000),
  knowledge  text not null check (char_length(btrim(knowledge)) between 1 and 4000),
  note       text check (note is null or char_length(note) <= 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ai_persona_versions enable row level security;

drop policy if exists "Admins read ai_persona_versions" on public.ai_persona_versions;
create policy "Admins read ai_persona_versions"
  on public.ai_persona_versions for select
  using (public.is_admin());

drop policy if exists "Admins add ai_persona_versions" on public.ai_persona_versions;
create policy "Admins add ai_persona_versions"
  on public.ai_persona_versions for insert
  with check (public.is_admin() and created_by = auth.uid());

-- مفيش policy للتعديل ولا المسح: السجل مبيتغيّرش من التطبيق ولا من اللوحة

-- نحتفظ بآخر ٥٠ نسخة بس (security definer عشان المسح يشتغل رغم إن مفيش policy مسح)
create or replace function public.prune_ai_persona_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ai_persona_versions
  where id <= (select id from public.ai_persona_versions order by id desc offset 50 limit 1);
  return null;
end;
$$;

drop trigger if exists ai_persona_versions_prune on public.ai_persona_versions;
create trigger ai_persona_versions_prune
  after insert on public.ai_persona_versions
  for each statement execute function public.prune_ai_persona_versions();

-- الدالة بتقرا بمفتاح service role (بيتجاوز RLS). الجدول مقفول على anon والطلاب.
revoke all on public.ai_persona_versions from anon;
