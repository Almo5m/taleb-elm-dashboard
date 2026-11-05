# ملفات SQL للوحة طالب علم

كلها بتتشغّل في Supabase → SQL Editor. قبل أي ملف فيه `⚠️` غيّر القيم اللي فيه
(anon key من الـ Legacy بيبدأ بـ `eyJ`، وسر الـ webhook) **من غير علامتي `< >`**.

للتأكد من اللي اتشغّل فعلًا: شغّل `verify_db_state.sql` (قراءة بس).

| الملف | بيعمل إيه | الحالة (2026-11-05) |
|---|---|---|
| `supabase_dashboard_v2.sql` | email في profiles، استهداف الإعلانات، فهارس | اتشغّل |
| `supabase_dashboard_v3.sql` | مشرف، سجل النشاط، كلمات ممنوعة، app_settings | اتشغّل |
| `supabase_realtime_reports.sql` | تحديث البلاغات لحظيًا | اتشغّل |
| `supabase_ai_assistant.sql` | إعدادات المساعد "بو" | اتشغّل |
| `supabase_admin_improvements.sql` | ai_chat_logs + تنبيهات تليجرام + تنظيف 60 يوم | اتشغّل |
| `supabase_backend_improvements_v2.sql` | rate limit + تصنيف الأسئلة + cron | اتشغّل |
| `supabase_rate_limit_upgrade.sql` | أعمدة نافذة الـ 15 رسالة/دقيقة | اتشغّل (2026-11-04) |
| `supabase_backend_improvements_v3.sql` | جدولة التقرير الأسبوعي | اتشغّل |
| `supabase_fix_signup_notification.sql` | تنبيه "طالب جديد" بعد تسجيل الاسم | اتشغّل |
| `supabase_critical_security_fix.sql` | يمنع الطالب يغيّر role/banned بتاعه | اتشغّل |
| `supabase_push_notifications_log.sql` | سجل الإشعارات | اتشغّل |
| `supabase_device_tokens.sql` | توكنات أجهزة الإشعارات | اتشغّل |
| `supabase_client_errors.sql` | جدول أعطال التطبيق + حد الإغراق | اتشغّل |
| `supabase_client_errors_alert.sql` | تنبيه الأعطال + تنظيفها (cron) | اتشغّل (2026-11-04) |
| `supabase_user_stats_privacy.sql` | قراءة user_stats للمسجّلين بس | اتشغّل (2026-11-05) |
| `supabase_emails.sql` | الإيميلات | مؤجل (محتاج دومين خاص) |

ملفات الأصل (`supabase_setup/forum/admin/moderation/features.sql`) في ريبو التطبيق مش هنا.
