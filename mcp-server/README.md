# طالب علم — MCP Server (قراءة فقط)

سيرفر MCP بيوصل Claude (من الموبايل أو أي جهاز) بلوحة تحكم طالب علم، بصلاحية
قراءة فقط. مفيش أي أداة كتابة في النسخة دي.

## طبقات الأمان

1. **Postgres role مخصص (`mcp_readonly`)**: عنده SELECT بس على الجداول
   المحتاجة، مفيش INSERT/UPDATE/DELETE خالص. حتى لو حصل خطأ في كود الـ
   Worker، الداتابيز نفسها هترفض أي كتابة.
2. **JWT قصير العمر (60 ثانية)**: موقّع وقت الطلب بالـ `role: mcp_readonly`،
   مش توكن ثابت متسرب ممكن يتستخدم لفترة طويلة.
3. **تسجيل الدخول عن طريق OAuth**: بنفس إيميل وباسورد الأدمن في لوحة
   التحكم، والتحقق إن `role = admin` قبل ما يدخل. مفيش حساب أو سيكريت جديد.
4. **قائمة جداول مغلقة (allowlist)**: أداة `query_table` مسموح لها بس
   بالجداول المعرّفة في `src/supabase.ts`، مش أي جدول تاني في الداتابيز.

## خطوات النشر

### 1) صلاحية القراءة في Supabase

شغّل `supabase_mcp_readonly.sql` في Supabase Dashboard → SQL Editor.

### 2) تثبيت الحزم

```bash
npm install
```

### 3) إنشاء مساحة تخزين الـ OAuth (KV Namespace)

```bash
npx wrangler kv namespace create OAUTH_KV
```

هيديك سطر فيه `id = "...."`، انسخه وحطه في `wrangler.toml` بدل
`REPLACE_WITH_KV_NAMESPACE_ID`.

### 4) الأسرار

**للنشر الفعلي على Cloudflare** (متتحطش في wrangler.toml):
```bash
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_JWT_SECRET
```

**للاختبار المحلي (`wrangler dev`)**: الأسرار اللي فوق بتتحط على السيرفر
البعيد بس، ومش بتوصل للـ `wrangler dev` المحلي. عشان تختبر محليًا، اعمل نسخة
من `.dev.vars.example` باسم `.dev.vars` (في نفس المجلد)، وحط فيها نفس
القيمتين:
```
SUPABASE_ANON_KEY="..."
SUPABASE_JWT_SECRET="..."
```
الملف ده متجاهل من Git تلقائيًا (موجود في `.gitignore`)، ومش محتاج تعمله
غير مرة واحدة على جهازك.

- `SUPABASE_ANON_KEY`: من Project Settings → API
- `SUPABASE_JWT_SECRET`: من Project Settings → API → JWT Secret (تبويب "Legacy JWT Secret" لو مشروعك محدّث لنظام الـ Signing Keys الجديد)

### 5) النشر

```bash
npx wrangler deploy
```

هيديك رابط زي:
`https://taleb-elm-mcp-server.<your-subdomain>.workers.dev/mcp`

### 5) الإضافة في تطبيق الموبايل / claude.ai

Settings → Connectors → Add custom connector → حط الرابط اللي فوق، وسجل
دخول بنفس إيميل وباسورد الأدمن بتاعك في اللوحة.

## الاختبار محليًا

```bash
npm run dev
```

## إضافة صلاحية كتابة لاحقًا

أي إجراء كتابة (تغيير حالة بلاغ، حظر حساب...) لازم يتضاف كـ tool منفصل
ومحدد جدًا في `src/mcp-agent.ts`، بينادي Edge Function في Supabase بنفس
نمط `admin-delete-user` — مش صلاحية UPDATE عامة على الـ `mcp_readonly` role.

---

جميع الحقوق محفوظة © 2026 Moaz (AlMo). انظر ملف LICENSE.
