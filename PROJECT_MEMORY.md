# ذاكرة مشروع لوحة تحكم طالب علم

ملف بيسجّل حالة المشروع وكل حدث مهم فيه. بيتحدّث مع كل تعديل.
**ممنوع** يتكتب فيه أي سر أو مفتاح (webhook secret، service_role، JWT secret).
المشاكل المعقدة وحلولها في `PROBLEMS_LOG.md`.

---

## المشروع في سطرين
لوحة تحكم أدمن لتطبيق "طالب علم" (تطبيق تعليمي مجاني لطلاب الثانوي في مصر).
React + Vite على Vercel (بيبني تلقائي من `main`)، والباك اند Supabase (Postgres + Edge Functions + pg_cron).
التطبيق نفسه (Flutter) في ريبو تاني، ومالوش علاقة بملفات الذاكرة دي.

## الهيكل
- `src/pages/` صفحات اللوحة، `src/lib/` (audit، csv، url، diff، appSettings، unlockables)، `src/constants/unlockables.js` كتالوج المميزات المقفولة
- `supabase/functions/` الـ Edge Functions
- `sql/` كل ملفات SQL (فيه `README.md` بالترتيب والحالة، و`verify_db_state.sql` للفحص)

## حالة الإنتاج (آخر تأكيد: 2026-11-05)
- **قاعدة البيانات:** كل ملفات `sql/` اتشغّلت ما عدا `supabase_emails.sql` (مؤجل). اتأكدنا بـ `verify_db_state.sql`.
- **الفنكشنز (نُشرت 2026-11-04):** ai-assistant v23، admin-ai-usage v12، telegram-notify v10، weekly-report v6، send-push-notification v4، client-errors-alert v2. غير متغيّرين: classify-ai-questions v3، admin-delete-user v9.
- **الأسرار:** `WEBHOOK_SECRET` اتغيّر 2026-11-04 (القيمة مش محفوظة في أي ملف، ومتتكتبش).
- **الإشعارات:** تليجرام (للأدمن) شغال، Push شغال، الإيميل مؤجل.
- **المميزات المقفولة:** صفحة اللوحة شغّالة وبتحفظ في `app_settings` (مفتاح `unlockables`). **التطبيق لسه مش بيقرأها**، فمفيش أي أثر على الطلاب.
- **الأمان:** trigger منع تصعيد الصلاحيات شغال، قراءة `user_stats` للمسجّلين بس، حماية CSV injection في كل صفحات التصدير.

## قرارات ثابتة (متتفتحش من غير سبب)
- المنهج (إدارة الدروس + لوحة التغطية + محرك الخطة) اتلغى. اللي فضل سويتش `catchup_enabled` بس. صفحة "خطط مذاكرة" القديمة متتلمسش.
- الإيميلات مؤجلة لحد دومين خاص.
- صفحة `/email-confirmed` اتشالت.
- موديل المساعد بيتحدد من `ai_assistant.model` في Settings (الافتراضي في الكود ممكن يرجّع 404).
- الـ anon key في ملفات SQL لازم يكون الـ Legacy (بيبدأ بـ `eyJ`) مش `sb_publishable_`.

## شغل مفتوح
- حذف الـ MCP (Cloudflare + role في Supabase + connector من Claude).
- ربط المميزات المقفولة بالتطبيق.
- الطالب لسه يقدر يعدّل أرقامه في `user_stats` (غش في المتصدرين).
- نشر النصوص القانونية وضبط `legal_links` و`share_settings` من Settings.
- تفعيل 2FA على حساب Supabase.
- Deep Links (في التطبيق)، تقييم 👍/👎 لردود "بو"، الإيميلات.

## أوامر التشغيل (PowerShell)
```powershell
npx vite build                                   # بناء اللوحة
supabase functions deploy <اسم-الفنكشن>          # نشر فنكشن
supabase functions list ; supabase secrets list  # فحص
supabase secrets set NAME=value                  # سر جديد (بالقيمة مباشرة، من غير pipe)
git add . ; git commit -m "..." ; git push origin main
```

---

## سجل الأحداث

### قبل 2026-11-04 (من ملف التسليم، من غير تواريخ دقيقة)
- بُنيت صفحات اللوحة (حسابات، منتدى، بلاغات، كلمات ممنوعة، إعلانات، إعدادات، سجل نشاط، إشعارات، أعطال التطبيق، المميزات المقفولة).
- تليجرام، التقرير الأسبوعي، تصنيف أسئلة المساعد، rate limit، تنظيف دوري للبيانات.
- شلنا كلمة سر ثابتة كانت في كود `BannedWords.jsx` وبقت تأكيد باسورد حسابك.
- Security headers + CSP على Vercel.
- بُني MCP Server على Cloudflare (قراءة فقط) وعمره ما اتستخدم.

### 2026-11-04
- فحص الـ DB: trigger الأمان شغّال، لكن `supabase_rate_limit_upgrade.sql` و`supabase_client_errors_alert.sql` ماكانوش متشغّلين.
- شغّلنا أعمدة rate limit، ونشرنا الفنكشنز الست (شوف الحالة فوق).
- غيّرنا `WEBHOOK_SECRET` في الفنكشنز وفي دالة `notify_telegram` وكل الـ cron jobs، وتأكدنا إن `net._http_response` رجّعت 200.
- شلنا السر القديم من أربع ملفات SQL (حطينا placeholder).
- شغّلنا `client_errors_alert` (cron اتسجّل، والفنكشن اتنشرت).
- جرّبت إضافة ميزة من صفحة المميزات المقفولة وحفظت. اتأكدنا إن التطبيق لسه مش بيقرأها.

### 2026-11-05
- حماية CSV injection في `src/lib/csv.js` (بتغطي الحسابات وسجل النشاط والبلاغات والمتصدرين).
- `sql/supabase_user_stats_privacy.sql`: اتشغّل ونجح.
- إنشاء ملفي الذاكرة والمشاكل.
- تجميع كل ملفات SQL في `sql/` + إضافة `sql/README.md` و`sql/verify_db_state.sql`.
- شلنا `mcp-server/` من الريبو وبنفّذ حذفه من Cloudflare وSupabase (لما يخلص نسجّل هنا).
