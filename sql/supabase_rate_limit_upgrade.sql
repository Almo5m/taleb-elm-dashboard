-- ============================================
-- طالب علم — ترقية Rate limiting من "فاصل ثابت" لـ "نافذة زمنية حقيقية"
-- شغّل الكود ده لو كنت شغّلت supabase_backend_improvements_v2.sql قبل كده
-- (لو لسه ماشغلتوش، النسخة المحدّثة منه فيها الأعمدة دي أصلًا، مش محتاج
-- تشغّل الملف ده تاني)
-- ============================================

alter table public.ai_rate_limit add column if not exists window_start timestamptz not null default now();
alter table public.ai_rate_limit add column if not exists request_count int not null default 0;
