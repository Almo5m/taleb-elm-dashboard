-- ============================================
-- طالب علم — تفعيل Realtime على جدول البلاغات
-- شغّل الكود ده في: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================
-- forum_threads و forum_replies أصلاً مفعّل عليهم Realtime من supabase_forum.sql،
-- لكن forum_reports (جدول البلاغات) لأ — وده لازم عشان بادچ البلاغات المعلّقة
-- في الـ sidebar يتحدّث لحظيًا من غير ما الأدمن يعمل ريفريش يدوي.

alter publication supabase_realtime add table public.forum_reports;
