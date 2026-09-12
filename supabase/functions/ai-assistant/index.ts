// ============================================
// طالب علم — Edge Function: ai-assistant
// ============================================
// النقطة الوحيدة في المشروع كله اللي فيها مفتاح الـ AI. التطبيق (Flutter)
// بينادي الدالة دي بس، مش بيكلم Gemini مباشرة أبدًا — عشان المفتاح مايتحطش
// جوه كود التطبيق (قابل للاستخراج من أي APK بفك الضغط).
//
// ⚠️⚠️ مهم جدًا: أي تعديل في الملف ده (زي تغيير SYSTEM_PROMPT أو أي منطق)
// لازم يترفع تاني يدويًا بالأمر تحت — مش زي كود Flutter اللي بيتحدث لحظة ما
// تثبت APK جديد. لو نسيت الخطوة دي، التطبيق هيفضل يكلم النسخة القديمة
// المنشورة فعليًا على سيرفرات Supabase، حتى لو الملف عندك محدّث تمامًا:
//
//   supabase functions deploy ai-assistant
//   supabase secrets set GEMINI_API_KEY=your_key_here   (مرة واحدة بس، مش لازم كل تحديث)
//
// (SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY متاحين تلقائيًا لأي Edge Function
// من غير ما تحطهم يدويًا)
// ============================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// معلومات عامة عن التطبيق + دور "بو" كمساعد دراسي شامل — مش محتاج RAG أو
// بحث، نص ثابت كفاية
const SYSTEM_PROMPT = `
انت اسمك "بو"، المساعد الذكي داخل تطبيق "طالب علم" — تطبيق مجاني لطلاب
الثانوية المصرية لتنظيم المذاكرة. عرّف نفسك بالاسم ده لو حد سألك مين انت.

دورك مكوّن من 3 حاجات:

1) أسئلة عن التطبيق نفسه (إزاي يستخدم ميزة معينة، فين يلاقي حاجة، إيه وظيفة
   كل تاب). ميزات التطبيق:
   - تاب "اليوم": مهام اليوم، وقت المذاكرة، محاضراتك الجاية، عداد الستريك
   - تاب "المواد": كل مادة فيها دروس، ملخصات، ملفات، مواعيد محاضرات
   - تاب "الجدول": تقويم بمواعيد الجلسات والامتحانات والمحاضرات
   - مؤقت بومودورو للمذاكرة المركّزة
   - منتدى طلابي مقسّم حسب الصف والنظام الدراسي (بحث، أسئلة، ردود، صور)
   - ركن ديني (أذكار، أدعية، تسبيح، صدقة جارية)
   - إنجازات ولوحة متصدرين
   - نسخ احتياطي واستيراد للبيانات من شاشة الإعدادات

2) دعم في الحياة الدراسية عمومًا: تنظيم وقت المذاكرة، التعامل مع قلق
   الامتحانات، التحفيز والتغلب على التسويف، إزاي يقسّم مذاكرته على أيام
   الأسبوع، نصايح عامة عن أساليب المذاكرة الفعالة.

3) مساعدة دراسية حقيقية في المواد: تقدر تشرح مفهوم، تحل مسألة، أو توضّح
   خطوات حل تمرين في أي مادة ثانوية (رياضيات، فيزياء، كيمياء، أحياء، لغات،
   إلخ). لو مش متأكد 100% من إجابة دقيقة (خصوصًا أرقام أو تفاصيل منهج
   محددة)، قول كده بصراحة وانصح الطالب يتأكد من المدرس أو الكتاب المدرسي —
   ماتختلقش معلومة إنت مش متأكد منها.

لو السؤال مش عن التطبيق ولا عن المذاكرة/الدراسة خالص (مواضيع شخصية بعيدة،
محتوى مش مناسب لسنه، إلخ)، اعتذر بلطف ووضّح إن ده مش من اختصاصك. ردودك قصيرة
ومباشرة (2-5 جمل حسب تعقيد السؤال)، بالعامية المصرية، ودودة زي صاحب بيشرحله.

مهم جدًا لتنسيق الرد: اكتب بـ Markdown نضيف وبسيط — **نص عريض** للتأكيد،
قوائم نقطية (-) أو مرقّمة (1. 2. 3.) لو محتاج خطوات، من غير أي رموز أو
علامات غريبة مالهاش لازمة. متسيبش نص متقطّع أو جملة ناقصة — لو الموضوع كبير،
اختصره بدل ما تبدأ فيه وتوقف في النص.
`.trim();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  // كلاينت بصلاحيات كاملة (service role) — بيتجاوز RLS، بيُستخدم للتحقق من
  // الحدود والتحديث. الاستخدام ده آمن هنا لأن الكود شغال على السيرفر بس
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // نتأكد إن التوكن الجاي من التطبيق فعلاً بتاع مستخدم مسجل دخول حقيقي
  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  const userId = userData.user.id;

  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }
  const message = body.message?.trim();
  if (!message) {
    return jsonResponse({ error: 'رسالة فاضية' }, 400);
  }

  // بنسجّل سؤال الطالب بس (مش رد الـ AI) في ai_chat_logs عشان الأدمن يقدر
  // يراجع هل الاستخدام في المنهج ولا لأ — بمحاولة أفضل جهد (best-effort)،
  // يعني لو فشل التسجيل لأي سبب، متوقفش رد الطالب خالص. الجدول ده بيتمسح
  // منه تلقائيًا أي صف أقدم من 60 يوم (شوف supabase_admin_improvements.sql)
  admin
    .from('ai_chat_logs')
    .insert({ user_id: userId, question: message })
    .then(({ error }) => {
      if (error) console.error('ai_chat_logs insert error:', error);
    });

  // 1) الميزة مفعّلة عمومًا في app_settings؟
  const { data: settingsRow } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', 'ai_assistant')
    .maybeSingle();

  const settings = settingsRow?.value as {
    enabled?: boolean;
    daily_limit_per_user?: number;
    monthly_limit_global?: number;
    model?: string;
  } | null;

  if (!settings?.enabled) {
    return jsonResponse({ blocked: true, reason: 'المساعد الذكي مش متاح دلوقتي' }, 200);
  }

  // 2) الميزة مفعّلة لنفس الطالب ده تحديدًا في ai_access؟
  const { data: access } = await admin
    .from('ai_access')
    .select('enabled, daily_limit_override')
    .eq('user_id', userId)
    .maybeSingle();

  if (!access?.enabled) {
    return jsonResponse({ blocked: true, reason: 'المساعد الذكي مش مفعّل على حسابك — كلّم الأدمن لو حابب تفعّله' }, 200);
  }

  // 3) الحد اليومي (مخصص للطالب لو موجود، وإلا الافتراضي العام)
  const dailyLimit = access.daily_limit_override ?? settings.daily_limit_per_user ?? 20;
  const today = new Date().toISOString().slice(0, 10); // yyyy-MM-dd

  const { data: dailyRow } = await admin
    .from('ai_usage_daily')
    .select('message_count')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .maybeSingle();

  const dailyCount = dailyRow?.message_count ?? 0;
  if (dailyCount >= dailyLimit) {
    return jsonResponse({ blocked: true, reason: 'وصلت لحد الرسائل بتاع النهاردة، جرّب تاني بكرة' }, 200);
  }

  // 4) السقف الشهري الإجمالي للتطبيق كله (بيفضل شغال فوق الكل، حماية أخيرة
  // للميزانية المجانية مهما كانت حدود الأفراد)
  const monthKey = today.slice(0, 7); // yyyy-MM
  const monthlyLimit = settings.monthly_limit_global ?? 3000;

  const { data: monthlyRow } = await admin
    .from('ai_usage_monthly')
    .select('message_count')
    .eq('month', monthKey)
    .maybeSingle();

  const monthlyCount = monthlyRow?.message_count ?? 0;
  if (monthlyCount >= monthlyLimit) {
    return jsonResponse({ blocked: true, reason: 'المساعد الذكي وصل لأقصى استخدام الشهر ده لكل الطلاب، حاول الشهر الجاي' }, 200);
  }

  // 5) كل الحدود تمام — نكلم Gemini
  const model = settings.model || 'gemini-2.5-flash-lite';
  let replyText: string;
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: message }] }],
          generationConfig: {
            maxOutputTokens: 4096,
            temperature: 0.6,
          },
        }),
      },
    );

    if (!geminiRes.ok) {
      // بنسجّل نص الخطأ الفعلي من Gemini في الـ logs (مش بس status code) —
      // يظهر في Supabase Dashboard → Edge Functions → ai-assistant → Logs،
      // عشان أي فشل جاي يبان سببه واضح بدل ما نضطر نخمّن
      const errBody = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errBody);
      return jsonResponse({ error: 'حصل خطأ، حاول تاني' }, 502);
    }

    const geminiData = await geminiRes.json();
    // بنجمع كل الـ parts مع بعض (مش parts[0] بس) — بعض الردود بتيجي مقسّمة
    // على أكتر من part، وده كان ممكن يفسّر جزء من مشكلة الردود الناقصة كمان
    const parts = geminiData?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined;
    replyText = parts?.map((p) => p.text ?? '').join('').trim() ?? '';

    // تسجيل السبب اللي خلّى Gemini يوقف — يظهر في Supabase Dashboard →
    // Edge Functions → ai-assistant → Logs. لو شفت "MAX_TOKENS" هنا رغم
    // الرفع لـ 4096، يبقى في مشكلة تانية غير حجم الميزانية نفسه
    const finishReason = geminiData?.candidates?.[0]?.finishReason;
    console.log('Gemini finishReason:', finishReason, '| reply length:', replyText.length);

    if (!replyText) {
      console.error('Gemini returned empty reply. Raw response:', JSON.stringify(geminiData));
      return jsonResponse({ error: 'حصل خطأ، حاول تاني' }, 502);
    }
  } catch (e) {
    console.error('Unexpected error calling Gemini:', e);
    return jsonResponse({ error: 'حصل خطأ، حاول تاني' }, 502);
  }

  // 6) تحديث العدادات (بعد نجاح الرد، مش قبله — عشان طلب فاشل ميستهلكش الحد)
  await admin
    .from('ai_usage_daily')
    .upsert({ user_id: userId, usage_date: today, message_count: dailyCount + 1 }, { onConflict: 'user_id,usage_date' });

  await admin
    .from('ai_usage_monthly')
    .upsert({ month: monthKey, message_count: monthlyCount + 1 }, { onConflict: 'month' });

  return jsonResponse({ reply: replyText });
});
