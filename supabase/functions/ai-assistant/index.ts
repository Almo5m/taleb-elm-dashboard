// ============================================
// طالب علم — Edge Function: ai-assistant
// ============================================
// النقطة الوحيدة في المشروع كله اللي فيها مفتاح الـ AI. التطبيق (Flutter)
// بينادي الدالة دي بس، مش بيكلم Gemini مباشرة أبدًا — عشان المفتاح مايتحطش
// جوه كود التطبيق (قابل للاستخراج من أي APK بفك الضغط).
//
// ⚠️⚠️ مهم جدًا: أي تعديل في الملفات دي (index.ts أو ai-core.ts) لازم يترفع تاني
// يدويًا بالأمر تحت — مش زي كود Flutter اللي بيتحدث لحظة ما تثبت APK جديد:
//
//   supabase functions deploy ai-assistant
//   supabase secrets set GEMINI_API_KEY=your_key_here   (مرة واحدة بس)
//
// (SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY متاحين تلقائيًا لأي Edge Function)
//
// شغّل sql/supabase_ai_model_state.sql قبل النشر (بس لو لسه ماتشغّلش الدالة بتشتغل
// عادي من غيره، من غير حفظ حالة الموديلات الخالصة).
//
// الطلبات اللي بتقبلها الدالة (POST):
//   message + history   → رد من بو، أو blocked:true مع code و reason
//   action = "status"   → حالة الطالب: مفعّل؟ باقي كام رسالة؟ (مبتستهلكش رسالة)
//
// المنطق الصافي (اليوم بتوقيت القاهرة، تصنيف أخطاء Gemini، سلسلة الموديلات، الـ history، الحالة)
// في ai-core.ts، واختباراته في tests/edge/.
// ============================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  availableModels,
  blockedBody,
  buildContents,
  buildModelChain,
  buildSystemPrompt,
  CAIRO_TZ,
  cairoDayKey,
  cairoMonthKey,
  classifyGeminiFailure,
  computeStatus,
  cooldownUntil,
  effectiveDailyLimit,
  extractUsage,
  isQuotaKind,
  KNOWLEDGE_MAX,
  mergeModelChains,
  pickActivePlan,
  pickPromptText,
  PERSONA_MAX,
  PREVIEW_MESSAGE_MAX,
  sanitizeHistory,
  type ActivePlan,
  type GeminiFailure,
} from './ai-core.ts';
import { DEFAULT_KNOWLEDGE, DEFAULT_PERSONA } from './persona-defaults.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type Admin = ReturnType<typeof createClient>;

// أقصى مدة لمحاولة واحدة، وأقصى مدة لكل المحاولات مع بعض (التطبيق بيستنى ٩٠ ثانية)
const ATTEMPT_TIMEOUT_MS = Number(Deno.env.get('AI_ATTEMPT_TIMEOUT_MS')) || 22_000; // المتغير للاختبارات بس
const TOTAL_BUDGET_MS = 60_000;

// شخصية بو ومعرفته بالتطبيق: بتتجاب من جدول ai_persona_versions (بتتعدّل من اللوحة)، ومخزّنة في الذاكرة
// دقيقة عشان مانزودش استعلام على كل رسالة. المتغير للاختبارات بس.
const PERSONA_CACHE_MS = Number(Deno.env.get('AI_PERSONA_CACHE_MS') ?? '60000');
let personaCache: { at: number; prompt: string } | null = null;

async function loadSystemPrompt(admin: Admin): Promise<string> {
  const nowMs = Date.now();
  if (personaCache && nowMs - personaCache.at < PERSONA_CACHE_MS) return personaCache.prompt;
  let persona = DEFAULT_PERSONA;
  let knowledge = DEFAULT_KNOWLEDGE;
  try {
    const { data, error } = await admin
      .from('ai_persona_versions')
      .select('persona, knowledge')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      // الجدول لسه ماتعملش أو الاستعلام فشل: بو يكمّل بالنص الافتراضي بدل ما يقع
      console.error('ai_persona_versions read failed:', error.message);
    } else if (data) {
      persona = pickPromptText(data.persona, PERSONA_MAX, DEFAULT_PERSONA);
      knowledge = pickPromptText(data.knowledge, KNOWLEDGE_MAX, DEFAULT_KNOWLEDGE);
    }
  } catch (e) {
    console.error('loadSystemPrompt error:', e);
  }
  const prompt = buildSystemPrompt(persona, knowledge);
  personaCache = { at: nowMs, prompt };
  return prompt;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** أي رسالة تليجرام بتعدّي من هنا. عمرها ما بترمي استثناء. */
async function sendTelegram(text: string) {
  try {
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error('sendTelegram error:', e);
  }
}

function fmtCairo(d: Date): string {
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: CAIRO_TZ, day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
}

// تنبيه تليجرام لو Gemini بيفشل لأسباب غير الحصة (ضغط، مفتاح، مهلة) — بـ debounce 10 دقايق
// عشان لو حصل outage مايغرقش تليجرام برسايل متكررة على كل طلب فاشل لوحده.
async function alertGeminiFailure(admin: Admin, detail: string) {
  try {
    const { data: state } = await admin
      .from('ai_error_alert_state')
      .select('last_alert_at')
      .eq('id', true)
      .maybeSingle();

    const lastAlertMs = state?.last_alert_at ? new Date(state.last_alert_at).getTime() : 0;
    if (Date.now() - lastAlertMs < 10 * 60 * 1000) return; // اتبعت تنبيه من أقل من 10 دقايق

    await admin.from('ai_error_alert_state').update({ last_alert_at: new Date().toISOString() }).eq('id', true);
    await sendTelegram(`⚠️ المساعد الذكي (بو) بيفشل في الرد\n${detail}`);
  } catch (e) {
    console.error('alertGeminiFailure error:', e);
  }
}

// ---------- حالة الموديلات (أنهي موديل خلصت حصته ولحد إمتى) ----------

interface Cooldown { until: Date; reason: string }

async function loadCooldowns(admin: Admin, now: Date): Promise<Map<string, Cooldown>> {
  const map = new Map<string, Cooldown>();
  try {
    const { data, error } = await admin
      .from('ai_model_state')
      .select('model, exhausted_until, reason')
      .gt('exhausted_until', now.toISOString());
    if (error) {
      console.error('ai_model_state read failed:', error.message);
      return map; // الجدول لسه ماتعملش؟ نكمّل من غير حالة محفوظة
    }
    for (const r of data ?? []) {
      if (String(r.model).startsWith('__') || !r.exhausted_until) continue;
      map.set(r.model, { until: new Date(r.exhausted_until), reason: r.reason ?? '' });
    }
  } catch (e) {
    console.error('loadCooldowns error:', e);
  }
  return map;
}

/** بيسجّل إن الموديل ده فشل ولحد إمتى نتخطّاه، وبيبعت تنبيه لما حصته اليومية تخلص لأول مرة */
async function markModelFailure(admin: Admin, cooldowns: Map<string, Cooldown>, model: string, failure: GeminiFailure, now: Date) {
  const until = cooldownUntil(failure, now);
  if (!until) return;
  cooldowns.set(model, { until, reason: failure.kind });
  try {
    const { data: prev } = await admin.from('ai_model_state').select('exhausted_until').eq('model', model).maybeSingle();
    const wasActive = !!prev?.exhausted_until && new Date(prev.exhausted_until).getTime() > now.getTime();
    await admin.from('ai_model_state').upsert(
      { model, exhausted_until: until.toISOString(), reason: failure.kind, detail: failure.detail.slice(0, 300), updated_at: now.toISOString() },
      { onConflict: 'model' },
    );
    if (failure.kind === 'quota_daily' && !wasActive) {
      await sendTelegram(`⚠️ حصة الموديل ${model} خلصت (حد يومي). هيرجع ${fmtCairo(until)} بتوقيت القاهرة.\nبو بيكمّل على الموديل التالي في السلسلة.`);
    }
  } catch (e) {
    console.error('markModelFailure error:', e);
  }
}

/** كل الموديلات خلصت: تنبيه واحد كل ٦ ساعات بالكتير */
async function alertAllExhausted(admin: Admin, retryAt: Date | null) {
  try {
    const { data } = await admin.from('ai_model_state').select('alerted_at').eq('model', '__all_exhausted__').maybeSingle();
    const last = data?.alerted_at ? new Date(data.alerted_at).getTime() : 0;
    if (Date.now() - last < 6 * 3600 * 1000) return;
    await admin.from('ai_model_state').upsert(
      { model: '__all_exhausted__', reason: 'all_exhausted', alerted_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'model' },
    );
    await sendTelegram(
      `🛑 كل موديلات بو خلصت حصتها، والطلاب بيشوفوا "رصيد بو خلص".${retryAt ? `\nأقرب رجوع: ${fmtCairo(retryAt)} بتوقيت القاهرة.` : ''}\nضيف موديل بديل من الإعدادات ← المساعد الذكي، أو فعّل الدفع في جوجل لو المشكلة بتتكرر.`,
    );
  } catch (e) {
    console.error('alertAllExhausted error:', e);
  }
}

// ---------- مكالمة Gemini ----------

type GeminiResult =
  | { ok: true; text: string; finishReason?: string; usage: { input: number; output: number } }
  | { ok: false; failure: GeminiFailure };

async function callGemini(model: string, contents: unknown, timeoutMs: number, systemPrompt: string): Promise<GeminiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      // المفتاح في الهيدر مش في الرابط (الروابط بتتسجّل أحيانًا)
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 4096, temperature: 0.6 },
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      // بنسجّل نص الخطأ الفعلي من Gemini (مش بس status code) — يظهر في Supabase Dashboard →
      // Edge Functions → ai-assistant → Logs، عشان أي فشل يبان سببه واضح بدل التخمين
      const errBody = await res.text();
      console.error('Gemini API error:', model, res.status, errBody);
      return { ok: false, failure: classifyGeminiFailure(res.status, errBody) };
    }

    const data = await res.json();
    // بنجمع كل الـ parts مع بعض (مش parts[0] بس) — بعض الردود بتيجي مقسّمة على أكتر من part
    const parts = data?.candidates?.[0]?.content?.parts as { text?: string }[] | undefined;
    const text = parts?.map((p) => p.text ?? '').join('').trim() ?? '';
    const finishReason = data?.candidates?.[0]?.finishReason as string | undefined;
    console.log('Gemini finishReason:', finishReason, '| model:', model, '| reply length:', text.length);

    if (!text) {
      console.error('Gemini returned empty reply. Raw response:', JSON.stringify(data));
      return { ok: false, failure: { kind: 'other', detail: `empty reply from ${model}` } };
    }
    return { ok: true, text, finishReason, usage: extractUsage(data) };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    console.error('Unexpected error calling Gemini:', model, e);
    return { ok: false, failure: classifyGeminiFailure(0, aborted ? 'timeout' : String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

// زيادة العدّادات ذرّيًا عن طريق ai_record_usage (sql/supabase_ai_usage_alerts.sql).
// لو الدالة لسه مااتعملتش في الـ DB بنرجع للطريقة القديمة (قراءة ثم كتابة)،
// عشان نشر الفنكشن قبل تشغيل ملف SQL مايوقّفش المساعد.
async function recordUsage(
  admin: ReturnType<typeof createClient>,
  userId: string,
  today: string,
  monthKey: string,
  dailyCount: number,
  monthlyCount: number,
): Promise<number> {
  const { data, error } = await admin.rpc('ai_record_usage', {
    p_user_id: userId,
    p_usage_date: today,
    p_month: monthKey,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (!error && row && typeof row.monthly_count === 'number') return row.monthly_count;

  if (error) console.error('ai_record_usage failed, using fallback:', error.message);
  await admin
    .from('ai_usage_daily')
    .upsert({ user_id: userId, usage_date: today, message_count: dailyCount + 1 }, { onConflict: 'user_id,usage_date' });
  await admin
    .from('ai_usage_monthly')
    .upsert({ month: monthKey, message_count: monthlyCount + 1 }, { onConflict: 'month' });
  return monthlyCount + 1;
}

// تنبيه تليجرام لما الاستهلاك الشهري يوصل 80% ثم 100% من السقف (مرة واحدة لكل نسبة في الشهر).
// عمره ما يكسر رد الطالب: أي خطأ هنا بيتسجّل في اللوج بس.
async function alertUsageThresholds(
  admin: ReturnType<typeof createClient>,
  monthlyCount: number,
  monthlyLimit: number,
  monthKey: string,
) {
  try {
    if (!(monthlyLimit > 0)) return;
    const reached = [100, 80].filter((t) => monthlyCount >= Math.ceil((monthlyLimit * t) / 100));
    if (reached.length === 0) return;

    let messageSent = false;
    for (const threshold of reached) {
      const { data, error } = await admin
        .from('ai_usage_alerts')
        .upsert({ month: monthKey, threshold, cap: monthlyLimit }, { onConflict: 'month,threshold,cap', ignoreDuplicates: true })
        .select();
      if (error) {
        console.error('ai_usage_alerts failed:', error.message);
        return;
      }
      const firstTime = !!data && data.length > 0;
      if (!firstTime || messageSent) continue; // اتبعت قبل كده، أو بعتنا رسالة أعلى نسبة بالفعل

      const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
      const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
      if (!token || !chatId) return;

      const text = threshold >= 100
        ? `🛑 المساعد الذكي (بو) وقف لكل الطلاب: وصل السقف الشهري (${monthlyCount} من ${monthlyLimit} رسالة، ${monthKey}).\nارفع السقف من الإعدادات ← المساعد الذكي لو عايزه يشتغل تاني قبل الشهر الجاي.`
        : `⚠️ المساعد الذكي (بو) وصل 80% من السقف الشهري (${monthlyCount} من ${monthlyLimit} رسالة، ${monthKey}).\nلو الاستهلاك مستمر هيقف لكل الطلاب. تقدر ترفع السقف من الإعدادات ← المساعد الذكي.`;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      messageSent = true;
    }
  } catch (e) {
    console.error('alertUsageThresholds error:', e);
  }
}

// ---------- الخطة الفعّالة للطالب (لو SQL الخطط لسه ماتشغّلش: مفيش خطة والباقي شغال عادي) ----------

async function loadActivePlan(admin: Admin, userId: string, now: Date): Promise<ActivePlan | null> {
  try {
    const { data: subs, error } = await admin
      .from('ai_subscriptions')
      .select('plan_id, status, starts_at, ends_at')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error || !subs?.length) return null;
    const ids = [...new Set(subs.map((r: { plan_id: number }) => r.plan_id))];
    // بنقرا الخطة حتى لو اتخفّت من قايمة الطلاب (is_active=false): المشترك الحالي مبيتأثرش
    const { data: plans } = await admin.from('ai_plans').select('id, name, daily_limit, models').in('id', ids);
    return pickActivePlan(subs, plans ?? [], now);
  } catch (e) {
    console.error('loadActivePlan error:', e);
    return null;
  }
}

// ---------- الحالة الكاملة للطالب (مشتركة بين الرد والـ status) ----------

async function loadState(admin: Admin, userId: string, now: Date) {
  const today = cairoDayKey(now); // يوم الطالب بيتجدد منتصف الليل بتوقيت القاهرة
  const monthKey = cairoMonthKey(now);

  const { data: settingsRow } = await admin.from('app_settings').select('value').eq('key', 'ai_assistant').maybeSingle();
  const settings = (settingsRow?.value ?? null) as {
    enabled?: boolean;
    daily_limit_per_user?: number;
    monthly_limit_global?: number;
    model?: string;
    fallback_models?: string[];
  } | null;

  const { data: access } = await admin.from('ai_access').select('enabled, daily_limit_override').eq('user_id', userId).maybeSingle();
  const plan = await loadActivePlan(admin, userId, now);

  const dailyLimit = effectiveDailyLimit({
    override: access?.daily_limit_override,
    planLimit: plan?.dailyLimit ?? null,
    defaultLimit: settings?.daily_limit_per_user ?? 20,
  });
  const { data: dailyRow } = await admin
    .from('ai_usage_daily')
    .select('message_count')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .maybeSingle();
  const dailyCount = dailyRow?.message_count ?? 0;

  // السقف الشهري الإجمالي للتطبيق كله (حماية أخيرة للميزانية مهما كانت حدود الأفراد)
  const monthlyLimit = settings?.monthly_limit_global ?? 3000;
  const { data: monthlyRow } = await admin.from('ai_usage_monthly').select('message_count').eq('month', monthKey).maybeSingle();
  const monthlyCount = monthlyRow?.message_count ?? 0;

  const chain = mergeModelChains(plan?.models ?? [], buildModelChain(settings?.model, settings?.fallback_models));
  const cooldowns = await loadCooldowns(admin, now);
  const models = availableModels(chain, cooldowns, now);

  const status = computeStatus({
    globalEnabled: !!settings?.enabled,
    userEnabled: !!access?.enabled || !!plan, // الاشتراك الفعّال بيفعّل بو حتى لو مفيش ai_access
    dailyLimit,
    usedToday: dailyCount,
    monthlyLimit,
    monthlyCount,
    modelsAvailable: models.available.length > 0,
    modelsRetryAt: models.earliestRetry,
    now,
    plan,
  });

  return { status, chain, cooldowns, available: models.available, dailyLimit, dailyCount, monthlyLimit, monthlyCount, today, monthKey, plan };
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

  let body: { message?: string; history?: unknown; action?: string; persona?: unknown; knowledge?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }

  // طلب "حالة" (التطبيق بيسأله أول ما الشات يفتح): مبيستهلكش رسالة ومبيعدّيش على حد المعدّل
  if (body.action === 'status') {
    const s = await loadState(admin, userId, new Date());
    return jsonResponse({ ok: true, status: s.status });
  }

  // تجربة الشخصية من اللوحة قبل الحفظ (أدمن بس): بتستخدم النص المبعوت من غير ما تلمس حدود الطلاب ولا
  // سجل الأسئلة. بتتحسب في سجل الاستهلاك عشان التكلفة تفضل دقيقة.
  if (body.action === 'preview') {
    const { data: me } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
    if (me?.role !== 'admin') return jsonResponse({ error: 'forbidden' }, 403);

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return jsonResponse({ error: 'رسالة فاضية' }, 400);
    if (message.length > PREVIEW_MESSAGE_MAX) return jsonResponse({ error: 'الرسالة طويلة' }, 400);
    const persona = typeof body.persona === 'string' ? body.persona.trim() : '';
    const knowledge = typeof body.knowledge === 'string' ? body.knowledge.trim() : '';
    if (!persona || persona.length > PERSONA_MAX) return jsonResponse({ error: 'نص الشخصية فاضي أو أطول من الحد' }, 400);
    if (!knowledge || knowledge.length > KNOWLEDGE_MAX) return jsonResponse({ error: 'نص معرفة التطبيق فاضي أو أطول من الحد' }, 400);

    const s = await loadState(admin, userId, new Date());
    const previewPrompt = buildSystemPrompt(persona, knowledge);
    const started = Date.now();
    for (const model of s.available) {
      const left = TOTAL_BUDGET_MS - (Date.now() - started);
      if (left < 4_000) break;
      const r = await callGemini(model, buildContents([], message), Math.min(ATTEMPT_TIMEOUT_MS, left), previewPrompt);
      if (r.ok) {
        admin
          .from('ai_usage_events')
          .insert({ user_id: userId, plan_id: null, model, input_tokens: r.usage.input, output_tokens: r.usage.output })
          .then(({ error }: { error: { message: string } | null }) => {
            if (error) console.error('ai_usage_events insert error:', error.message);
          });
        return jsonResponse({ ok: true, reply: r.text, model });
      }
      if (r.failure.kind === 'auth') break;
    }
    return jsonResponse({ error: 'مفيش موديل رد دلوقتي. جرّب بعد شوية', code: 'busy' }, 502);
  }

  // Rate limiting بطبقتين:
  // 1) فاصل أدنى 3 ثواني بين كل رسالة والتانية (يمنع bug في التطبيق أو ضغط متكرر سريع)
  // 2) نافذة حقيقية 60 ثانية بحد أقصى 15 رسالة — بتمنع طالب من "التحايل" على فاصل
  //    الـ 3 ثواني؛ النافذة بتتصفّر تلقائيًا كل 60 ثانية من أول رسالة فيها
  const MAX_PER_WINDOW = 15;
  const WINDOW_MS = 60_000;

  const { data: rateLimitRow } = await admin
    .from('ai_rate_limit')
    .select('last_request_at, window_start, request_count')
    .eq('user_id', userId)
    .maybeSingle();

  const now = Date.now();

  if (rateLimitRow && now - new Date(rateLimitRow.last_request_at).getTime() < 3000) {
    return jsonResponse(blockedBody('too_fast'), 200);
  }

  let windowStart = now;
  let requestCount = 1;

  if (rateLimitRow) {
    const windowAgeMs = now - new Date(rateLimitRow.window_start).getTime();
    if (windowAgeMs < WINDOW_MS) {
      if (rateLimitRow.request_count >= MAX_PER_WINDOW) {
        return jsonResponse(blockedBody('too_many'), 200);
      }
      windowStart = new Date(rateLimitRow.window_start).getTime();
      requestCount = rateLimitRow.request_count + 1;
    }
  }

  await admin.from('ai_rate_limit').upsert({
    user_id: userId,
    last_request_at: new Date(now).toISOString(),
    window_start: new Date(windowStart).toISOString(),
    request_count: requestCount,
  });

  const message = body.message?.trim();
  if (!message) {
    return jsonResponse({ error: 'رسالة فاضية' }, 400);
  }
  if (message.length > 4000) {
    return jsonResponse({ error: 'الرسالة طويلة أوي' }, 400);
  }

  // بنسجّل سؤال الطالب بس (مش رد الـ AI) في ai_chat_logs عشان الأدمن يقدر يراجع هل الاستخدام
  // في المنهج ولا لأ — best-effort: لو فشل التسجيل متوقفش رد الطالب. بيتمسح تلقائيًا بعد 60 يوم.
  // (بنسجّل حتى الأسئلة اللي بتتحظر — دي بتوري حجم الطلب الحقيقي على بو)
  admin
    .from('ai_chat_logs')
    .insert({ user_id: userId, question: message })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error('ai_chat_logs insert error:', error);
    });

  // الحدود كلها (الميزة شغالة؟ الطالب مفعّل؟ حده اليومي؟ السقف الشهري؟ فيه موديل متاح؟)
  // بتتحسب في مكان واحد — نفس اللي بيشوفه الطالب في التطبيق
  const s = await loadState(admin, userId, new Date());
  if (!s.status.available) {
    const extra: Record<string, unknown> = { status: s.status };
    if (s.status.retry_at) extra.retry_at = s.status.retry_at;
    return jsonResponse(blockedBody(s.status.state, extra), 200);
  }

  // كل الحدود تمام — نكلم Gemini بالترتيب: الأساسي، وبعده البدائل لو فشل أو حصته خلصت
  const contents = buildContents(sanitizeHistory(body.history), message);
  const systemPrompt = await loadSystemPrompt(admin);
  const started = Date.now();
  const failures: { model: string; failure: GeminiFailure }[] = [];
  let replyText: string | null = null;
  let usedModel = '';
  let usage = { input: 0, output: 0 };

  for (const model of s.available) {
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (left < 4_000) break;
    const r = await callGemini(model, contents, Math.min(ATTEMPT_TIMEOUT_MS, left), systemPrompt);
    if (r.ok) {
      replyText = r.text;
      usedModel = model;
      usage = r.usage;
      break;
    }
    failures.push({ model, failure: r.failure });
    await markModelFailure(admin, s.cooldowns, model, r.failure, new Date());
    if (r.failure.kind === 'auth') break; // المفتاح نفسه واقع — مفيش فايدة من باقي الموديلات
  }

  if (replyText === null) {
    // لو السبب إن كل الموديلات حصتها خلصت: ده مش خطأ، ده "رصيد بو خلص" بوقت رجوع واضح
    const after = availableModels(s.chain, s.cooldowns, new Date());
    const allQuota = failures.length > 0 && failures.every((f) => isQuotaKind(f.failure.kind));
    if (after.available.length === 0 && after.allQuota && allQuota) {
      await alertAllExhausted(admin, after.earliestRetry);
      const status = { ...s.status, state: 'models_exhausted', available: false, retry_at: after.earliestRetry?.toISOString() ?? null };
      return jsonResponse(blockedBody('models_exhausted', { status, retry_at: status.retry_at }), 200);
    }
    const last = failures[failures.length - 1];
    await alertGeminiFailure(
      admin,
      last ? `الموديل ${last.model} → ${last.failure.kind}\n${last.failure.detail.slice(0, 160)}` : 'محدش من الموديلات اشتغل (الوقت خلص قبل أي محاولة)',
    );
    return jsonResponse({ error: 'حصل خطأ، حاول تاني', code: 'busy' }, 502);
  }

  // تحديث العدادات (بعد نجاح الرد، مش قبله — عشان طلب فاشل ميستهلكش الحد)
  const newMonthlyCount = await recordUsage(admin, userId, s.today, s.monthKey, s.dailyCount, s.monthlyCount);

  // سجل التكلفة: الموديل وعدد التوكنز (من غير أي محتوى). best-effort: فشله مبيأثرش على الرد
  admin
    .from('ai_usage_events')
    .insert({ user_id: userId, plan_id: s.plan?.id ?? null, model: usedModel, input_tokens: usage.input, output_tokens: usage.output })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error('ai_usage_events insert error:', error.message);
    });

  // تنبيه الـ 80% / 100%: بعد ما الرد يتبعت للطالب لو البيئة بتدعم waitUntil، عشان مايتأخرش
  const alertJob = alertUsageThresholds(admin, newMonthlyCount, s.monthlyLimit, s.monthKey);
  // deno-lint-ignore no-explicit-any
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(alertJob);
  else await alertJob;

  return jsonResponse({
    reply: replyText,
    daily_limit: s.dailyLimit,
    remaining_today: Math.max(0, s.dailyLimit - s.dailyCount - 1),
  });
});
