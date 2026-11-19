# ملفات SQL للوحة طالب علم

كلها بتتشغّل في Supabase → SQL Editor. قبل أي ملف فيه `⚠️` غيّر القيم اللي فيه
(anon key من الـ Legacy بيبدأ بـ `eyJ`، وسر الـ webhook) **من غير علامتي `< >`**.

للتأكد من اللي اتشغّل فعلًا: شغّل `verify_db_state.sql` (قراءة بس).
أدوات فحص تانية (قراءة بس): `inspect_user_stats.sql` (أعمدة وpolicies جدول user_stats)، و`check_rls.sql` (فحص أمان: جداول من غير RLS ودوال مفتوحة للـ API، المفروض يرجّع صفر صفوف ما عدا is_staff).
لمراجعة مخالفات الحارس: `select * from public.user_stats_flags order by created_at desc limit 50;` والوضع الحالي: `select mode from public.user_stats_guard_config;`

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
| `supabase_user_stats_guard.sql` | حارس يكشف القيم المستحيلة في أرقام المتصدرين (وضع log ثم clamp)، من غير حسابات وقت | جاهز، لسه مااتشغّلش |
| `supabase_ai_auto_enable.sql` | تفعيل المساعد الذكي تلقائيًا للطلاب الجدد (اختياري، بيتحكم فيه من الإعدادات) | جاهز، لسه مااتشغّلش |
| `supabase_security_hardening.sql` | **مهم**: يقفل جدولين من غير RLS ودالة تليجرام كانت مفتوحة للـ API | جاهز، لسه مااتشغّلش |
| `supabase_ai_usage_alerts.sql` | عدّاد استخدام المساعد دقيق + تنبيه تليجرام عند 80% و100% من السقف الشهري | جاهز، لسه مااتشغّلش |
| `supabase_client_errors_v2.sql` | views تجميع الأعطال بالبصمة + حالة العطل (جاية من كلود التطبيق، **انسخها هنا في فولدر sql** وشغّلها قبل صفحة الأعطال الجديدة) | لسه مااتشغّلش |
| `supabase_client_error_alerts.sql` | تنبيه تليجرام للباجات الحقيقية (3 أجهزة) والأعطال اللي رجعت بعد الإصلاح | جاهز، لسه مااتشغّلش |
| `supabase_division_fix.sql` | تصحيح الطلاب اللي اختاروا شعب مش موجودة (بيبدأ بمعاينة). **من كلود التطبيق، انسخه هنا** | لسه مااتشغّلش |
| `supabase_profile_division_lock.sql` | منع الطالب من تغيير نظامه وصفه وشعبته بنفسه (الأدمن مش متأثر). **من كلود التطبيق** | لسه مااتشغّلش |
| `supabase_catalog_lessons.sql` | جدولين `catalog_subjects` (183 مادة في 20 توليفة) و`catalog_lessons`. **من كلود التطبيق** | لسه مااتشغّلش |
| `supabase_division_promotion.sql` | الترقية الجماعية: معاينة + نسخة احتياطية + تنفيذ في معاملة واحدة | جاهز، لسه مااتشغّلش (بعد التلاتة اللي فوق) |
| `supabase_catalog_admin.sql` | view عدّادات الدروس لكل مادة (لصفحة دروس المنهج) | جاهز، لسه مااتشغّلش (بعد `supabase_catalog_lessons.sql`) |
| `supabase_ai_model_state.sql` | حالة موديلات بو (أنهي موديل خلصت حصته ولحد إمتى). بتستخدمها دالة `ai-assistant` الجديدة وكارت "حالة موديلات بو" في الإعدادات. شغّلها قبل نشر الدالة | جاهز، لسه مااتشغّلش (**من كلود التطبيق**) |
| `supabase_ai_plans.sql` | خطط واشتراكات بو + سجل التكلفة (`ai_plans`, `ai_subscriptions`, `ai_usage_events` + views للوحة). شغّلها بعد `supabase_ai_model_state.sql` | جاهز، لسه مااتشغّلش (**من كلود التطبيق**) |
| `supabase_emails.sql` | الإيميلات | مؤجل (محتاج دومين خاص) |

ملفات الأصل (`supabase_setup/forum/admin/moderation/features.sql`) في ريبو التطبيق مش هنا.
