// اختبار الدالة كاملة (index.ts) من الطلب لحد الرد، بـ Supabase بديل في الذاكرة و Gemini مزيّف.
// التشغيل: deno test --no-lock --allow-read --allow-env --import-map=tests/edge/import_map.json tests/edge/
// deno-lint-ignore-file no-explicit-any
import { db, failTables, resetDb, table, users } from './supabase_stub.ts';
import { cairoDayKey } from '../../supabase/functions/ai-assistant/ai-core.ts';
import { eq, ok } from './assert.ts';

const f429 = await Deno.readTextFile(new URL('./fixtures/gemini_429_daily.json', import.meta.url));
const f503 = await Deno.readTextFile(new URL('./fixtures/gemini_503.json', import.meta.url));

// --- نلتقط الـ handler بدل ما Deno.serve يفتح سيرفر ---
let handler: (req: Request) => Promise<Response>;
Object.defineProperty(Deno, 'serve', { value: (h: any) => { handler = h; return {}; }, configurable: true, writable: true });
for (const [k, v] of Object.entries({
  SUPABASE_URL: 'http://stub', SUPABASE_SERVICE_ROLE_KEY: 'srv', GEMINI_API_KEY: 'SECRET-KEY-123',
  TELEGRAM_BOT_TOKEN: 'tg', TELEGRAM_CHAT_ID: '1', AI_ATTEMPT_TIMEOUT_MS: '80',
})) Deno.env.set(k, v);
await import('../../supabase/functions/ai-assistant/index.ts');

// --- Gemini + تليجرام مزيّفين ---
type Behavior = 'ok' | '429' | '503' | '403' | 'hang' | 'empty';
const behaviors: Record<string, Behavior> = {};
const geminiCalls: { model: string; url: string; headers: any; body: any }[] = [];
const telegram: string[] = [];
globalThis.fetch = (input: any, init?: any) => {
  const url = String(input);
  if (url.includes('api.telegram.org')) {
    telegram.push(JSON.parse(init.body).text);
    return Promise.resolve(new Response('{}'));
  }
  const model = url.match(/models\/([^:]+):/)![1];
  geminiCalls.push({ model, url, headers: init.headers, body: JSON.parse(init.body) });
  switch (behaviors[model] ?? 'ok') {
    case '429': return Promise.resolve(new Response(f429, { status: 429 }));
    case '503': return Promise.resolve(new Response(f503, { status: 503 }));
    case '403': return Promise.resolve(new Response('{"error":{"message":"API key not valid"}}', { status: 403 }));
    case 'empty': return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }] } }] }), { status: 200 }));
    case 'hang': return new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    default: return Promise.resolve(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: `رد من ${model}` }] } }] }), { status: 200 }));
  }
};

function setup(opts: { settings?: Record<string, unknown> | null; enabled?: boolean | null; used?: number; monthly?: number } = {}) {
  resetDb();
  for (const k of Object.keys(behaviors)) delete behaviors[k];
  geminiCalls.length = 0;
  telegram.length = 0;
  users.set('t1', 'u1');
  users.set('t2', 'u2');
  if (opts.settings !== null) {
    table('app_settings').push({ key: 'ai_assistant', value: { enabled: true, model: 'm1', fallback_models: ['m2', 'm3'], daily_limit_per_user: 5, monthly_limit_global: 3000, ...opts.settings } });
  }
  if (opts.enabled !== null) table('ai_access').push({ user_id: 'u1', enabled: opts.enabled ?? true });
  if (opts.used) table('ai_usage_daily').push({ user_id: 'u1', usage_date: cairoDayKey(), message_count: opts.used });
  if (opts.monthly) table('ai_usage_monthly').push({ month: cairoDayKey().slice(0, 7), message_count: opts.monthly });
  table('ai_error_alert_state').push({ id: true, last_alert_at: null });
}

async function call(body: unknown, token: string | null = 't1') {
  table('ai_rate_limit').length = 0; // عشان فاصل الـ ٣ ثواني ميعطّلش الاختبارات المتتالية
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await handler(new Request('http://x/', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const ask = (message: string, history: unknown[] = []) => call({ message, history });
const status = () => call({ action: 'status' });

Deno.test('status: طالب مفعّل وفاضله ٥، ومبيستهلكش رسالة ولا بيكلّم جوجل', async () => {
  setup();
  const r = await status();
  eq(r.status, 200, 'http');
  eq([r.json.status.state, r.json.status.available, r.json.status.daily_limit, r.json.status.remaining_today], ['ok', true, 5, 5], 'الحالة');
  ok(r.json.status.resets_at, 'وقت التجديد');
  eq([geminiCalls.length, table('ai_usage_daily').length, table('ai_rate_limit').length, table('ai_chat_logs').length], [0, 0, 0, 0], 'مفيش أثر جانبي');
});

Deno.test('status: غير مفعّل / الميزة واقفة / خلّص يومه / السقف الشهري', async () => {
  setup({ enabled: null }); eq((await status()).json.status.state, 'not_enabled', 'مفيش ai_access');
  setup({ enabled: false }); eq((await status()).json.status.state, 'not_enabled', 'enabled=false');
  setup({ settings: { enabled: false } }); eq((await status()).json.status.state, 'feature_off', 'واقفة عالميًا');
  setup({ settings: null }); eq((await status()).json.status.state, 'feature_off', 'مفيش إعدادات أصلًا');
  setup({ used: 5 }); const d = (await status()).json.status; eq([d.state, d.remaining_today], ['daily_limit', 0], 'الحد اليومي');
  setup({ monthly: 3000 }); eq((await status()).json.status.state, 'monthly_limit', 'الشهري');
  setup(); table('ai_access')[0].daily_limit_override = 9; eq((await status()).json.status.daily_limit, 9, 'حد مخصص للطالب');
});

Deno.test('رد ناجح من الأساسي: المفتاح في الهيدر، العدّاد بتوقيت القاهرة، والباقي بيرجع في الرد', async () => {
  setup();
  const r = await ask('اشرحلي قانون أوم');
  eq([r.status, r.json.reply, r.json.remaining_today, r.json.daily_limit], [200, 'رد من m1', 4, 5], 'الرد');
  eq(geminiCalls.length, 1, 'مكالمة واحدة');
  ok(!geminiCalls[0].url.includes('SECRET-KEY-123'), 'المفتاح مش في الرابط');
  eq(geminiCalls[0].headers['x-goog-api-key'], 'SECRET-KEY-123', 'المفتاح في الهيدر');
  eq(db.ai_usage_daily[0].usage_date, cairoDayKey(), 'تاريخ العدّاد = يوم القاهرة');
  eq(db.ai_usage_daily[0].message_count, 1, 'اتسجّلت رسالة');
  eq(db.ai_chat_logs.length, 1, 'سؤال الطالب اتسجّل');
});

Deno.test('الموديل الأساسي خلصت حصته: بيكمّل على البديل وبيتخطّاه بعد كده، وتنبيه واحد بس', async () => {
  setup();
  behaviors.m1 = '429';
  const r1 = await ask('س١');
  eq([r1.status, r1.json.reply], [200, 'رد من m2'], 'نجح على البديل');
  eq(geminiCalls.map((c) => c.model), ['m1', 'm2'], 'جرّب الأساسي الأول');
  const row = db.ai_model_state.find((r) => r.model === 'm1')!;
  eq(row.reason, 'quota_daily', 'السبب');
  const secs = (new Date(row.exhausted_until).getTime() - Date.now()) / 1000;
  ok(secs > 64000 && secs < 65000, `وقت الرجوع من رد جوجل (${secs})`);
  eq(telegram.filter((t) => t.includes('خلصت') && t.includes('m1')).length, 1, 'تنبيه تليجرام للموديل');

  geminiCalls.length = 0;
  const r2 = await ask('س٢');
  eq([r2.json.reply, geminiCalls.map((c) => c.model)], ['رد من m2', ['m2']], 'التاني اتخطّى m1 من غير ما يضرب جوجل');
  eq(telegram.filter((t) => t.includes('m1')).length, 1, 'مفيش تنبيه مكرر');
});

Deno.test('كل الموديلات حصتها خلصت: رد "رصيد بو خلص" مش خطأ، بوقت رجوع، وتنبيه واحد', async () => {
  setup();
  behaviors.m1 = behaviors.m2 = behaviors.m3 = '429';
  const r = await ask('س');
  eq([r.status, r.json.blocked, r.json.code], [200, true, 'models_exhausted'], 'محظور بكود واضح');
  ok(r.json.retry_at && new Date(r.json.retry_at) > new Date(), 'وقت رجوع');
  eq(geminiCalls.length, 3, 'جرّب التلاتة');
  eq(table('ai_usage_daily').length, 0, 'مفيش رسالة اتحسبت على الطالب');
  eq(telegram.filter((t) => t.includes('كل موديلات')).length, 1, 'تنبيه "الكل خلص"');

  geminiCalls.length = 0;
  const r2 = await ask('س تاني');
  eq([r2.json.code, geminiCalls.length], ['models_exhausted', 0], 'بعدها مفيش أي مكالمة لجوجل');
  eq(telegram.filter((t) => t.includes('كل موديلات')).length, 1, 'التنبيه مبيتكررش');
  eq((await status()).json.status.state, 'models_exhausted', 'والـ status بيقول نفس الحاجة');
});

Deno.test('٥٠٣ على الأساسي: بيكمّل على البديل (من غير تنبيه حصة)', async () => {
  setup();
  behaviors.m1 = '503';
  const r = await ask('س');
  eq(r.json.reply, 'رد من m2', 'نجح على البديل');
  eq(db.ai_model_state.find((x) => x.model === 'm1')!.reason, 'overloaded', 'سبب قصير');
  eq(telegram.length, 0, 'مفيش تنبيه');
});

Deno.test('كل الموديلات ٥٠٣: خطأ ٥٠٢ بكود busy، وتنبيه مرة واحدة (debounce)', async () => {
  setup();
  behaviors.m1 = behaviors.m2 = behaviors.m3 = '503';
  const r = await ask('س');
  eq([r.status, r.json.code], [502, 'busy'], 'خطأ مؤقت');
  eq(table('ai_usage_daily').length, 0, 'مفيش استهلاك');
  eq(telegram.filter((t) => t.includes('بيفشل')).length, 1, 'تنبيه');
  await ask('س٢');
  eq(telegram.filter((t) => t.includes('بيفشل')).length, 1, 'debounce ١٠ دقايق');
});

Deno.test('مهلة: موديل بيعلّق بيتحوّل للبديل بدل ما الطلب يقف', async () => {
  setup();
  behaviors.m1 = 'hang';
  const t0 = Date.now();
  const r = await ask('س');
  eq(r.json.reply, 'رد من m2', 'البديل رد');
  ok(Date.now() - t0 < 3000, 'خلص بسرعة (المهلة ٨٠ms في الاختبار)');
  eq(db.ai_model_state.find((x) => x.model === 'm1')!.reason, 'timeout', 'سبب المهلة');
});

Deno.test('مفتاح Gemini غلط (٤٠٣): مبيجرّبش باقي الموديلات وبيبلّغ', async () => {
  setup();
  behaviors.m1 = '403';
  const r = await ask('س');
  eq([r.status, geminiCalls.length], [502, 1], 'وقف عند أول مفتاح فاشل');
  eq(db.ai_model_state?.length ?? 0, 0, 'مفيش تخطّي لموديل بسبب المفتاح');
  eq(telegram.length, 1, 'تنبيه');
});

Deno.test('رد فاضي من موديل: بيجرّب اللي بعده', async () => {
  setup();
  behaviors.m1 = 'empty';
  eq((await ask('س')).json.reply, 'رد من m2', 'البديل');
});

Deno.test('الحدود: مش مفعّل / واقفة / خلّص يومه / السقف الشهري — كلها من غير ما تضرب جوجل', async () => {
  const cases: [string, Parameters<typeof setup>[0], string][] = [
    ['مش مفعّل', { enabled: null }, 'not_enabled'],
    ['واقفة', { settings: { enabled: false } }, 'feature_off'],
    ['خلّص يومه', { used: 5 }, 'daily_limit'],
    ['الشهري', { monthly: 3000 }, 'monthly_limit'],
  ];
  for (const [name, opts, code] of cases) {
    setup(opts);
    const r = await ask('س');
    eq([r.status, r.json.blocked, r.json.code], [200, true, code], name);
    ok(typeof r.json.reason === 'string' && r.json.reason.length > 0, `${name}: فيه reason للنسخ القديمة`);
    eq(geminiCalls.length, 0, `${name}: مفيش مكالمة لجوجل`);
    eq(table('ai_usage_daily').length, opts?.used ? 1 : 0, `${name}: مفيش استهلاك جديد`);
  }
});

Deno.test('الذاكرة: history بتتبعت لجوجل منضّفة ومتناوبة والسؤال الجديد في الآخر', async () => {
  setup();
  await ask('سؤال جديد', [
    { role: 'model', text: 'تائه' }, { role: 'user', text: 'س١' }, { role: 'bot', text: 'ج١' },
    { role: 'user', text: 'س٢' }, { role: 'model', text: 'ج٢' }, { role: 'user', text: 'معلّق' },
  ]);
  const roles = geminiCalls[0].body.contents.map((c: any) => c.role);
  eq(roles, ['user', 'model', 'user', 'model', 'user'], 'تناوب سليم');
  eq(geminiCalls[0].body.contents.at(-1).parts[0].text, 'سؤال جديد', 'السؤال الجديد في الآخر');
  eq(geminiCalls[0].body.contents[1].parts[0].text, 'ج١', 'bot اتحوّل لـ model');
});

Deno.test('جدول حالة الموديلات لسه ماتعملش (SQL ماتشغّلش): الدالة بتشتغل عادي', async () => {
  setup();
  failTables.add('ai_model_state');
  behaviors.m1 = '429';
  const r = await ask('س');
  eq(r.json.reply, 'رد من m2', 'الفallback شغال حتى من غير الجدول');
  failTables.add('ai_model_state');
  eq((await status()).json.status.state, 'ok', 'والـ status كمان');
});

Deno.test('معدّل الطلبات والتحقق من الهوية', async () => {
  setup();
  // فاصل ٣ ثواني: بنعمل طلبين ورا بعض من غير تصفير ai_rate_limit
  const send = () => handler(new Request('http://x/', { method: 'POST', headers: { Authorization: 'Bearer t1' }, body: JSON.stringify({ message: 'س' }) }));
  const a = await (await send()).json();
  const b = await (await send()).json();
  eq([a.reply !== undefined, b.code], [true, 'too_fast'], 'التاني اترفض بكود too_fast');

  const noAuth = await handler(new Request('http://x/', { method: 'POST', body: '{}' }));
  eq(noAuth.status, 401, 'من غير توكن');
  eq((await call({ message: 'س' }, 'bad-token')).status, 401, 'توكن غلط');
  eq((await call({ message: '   ' })).status, 400, 'رسالة فاضية');
  const get = await handler(new Request('http://x/', { method: 'GET' }));
  eq(get.status, 405, 'GET');
});

// ---------- الخطط والاشتراكات ----------
const DAY = 24 * 3600 * 1000;
function subscribe(over: Record<string, unknown> = {}, plan: Record<string, unknown> = {}) {
  table('ai_plans').push({ id: 7, name: 'المتفوق', daily_limit: 30, models: [], is_active: true, ...plan });
  table('ai_subscriptions').push({ user_id: 'u1', plan_id: 7, status: 'active', starts_at: new Date(Date.now() - DAY).toISOString(), ends_at: new Date(Date.now() + 10 * DAY).toISOString(), ...over });
}

Deno.test('مشترك مش مفعّل في ai_access: بو شغال، وحده من الخطة، وبيانات الخطة في status', async () => {
  setup({ enabled: null });
  subscribe();
  const st = (await status()).json.status;
  eq([st.state, st.daily_limit, st.plan.name, st.plan.days_left], ['ok', 30, 'المتفوق', 10], 'status');
  const r = await ask('س');
  eq([r.status, r.json.reply, r.json.daily_limit, r.json.remaining_today], [200, 'رد من m1', 30, 29], 'رد بحد الخطة');
});

Deno.test('اشتراك منتهي أو ملغي: الطالب بيرجع للقواعد العادية', async () => {
  setup({ enabled: null });
  subscribe({ ends_at: new Date(Date.now() - 1000).toISOString() });
  eq((await status()).json.status.state, 'not_enabled', 'منتهي');
  setup({ enabled: null });
  subscribe({ status: 'cancelled' });
  eq((await status()).json.status.state, 'not_enabled', 'ملغي');
  setup({ enabled: true });
  subscribe({ ends_at: new Date(Date.now() - 1000).toISOString() });
  const st = (await status()).json.status;
  eq([st.state, st.daily_limit, st.plan], ['ok', 5, null], 'المفعّل بيرجع لحده العادي');
});

Deno.test('المشترك مبيتأثرش بالسقف الشهري العام، وغيره بيتأثر', async () => {
  setup({ enabled: null, monthly: 3000 });
  subscribe();
  eq((await ask('س')).json.reply, 'رد من m1', 'مشترك');
  setup({ monthly: 3000 });
  eq((await ask('س')).json.code, 'monthly_limit', 'غير مشترك');
});

Deno.test('موديلات الخطة بتتجرّب الأول وبعدها العامة كاحتياطي', async () => {
  setup();
  subscribe({}, { models: ['pro-1'] });
  behaviors['pro-1'] = '429';
  const r = await ask('س');
  eq(geminiCalls.map((c) => c.model), ['pro-1', 'm1'], 'موديل الخطة ثم العام');
  eq(r.json.reply, 'رد من m1', 'نجح على العام');
  eq(db.ai_model_state.find((x) => x.model === 'pro-1')?.reason, 'quota_daily', 'موديل الخطة اتسجّل خالص');
});

Deno.test('تسجيل التكلفة: الموديل والتوكنز ورقم الخطة، من غير أي محتوى', async () => {
  setup();
  subscribe();
  const origFetch = globalThis.fetch;
  globalThis.fetch = (input: any, init?: any) => String(input).includes('generativelanguage')
    ? Promise.resolve(new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'رد' }] } }], usageMetadata: { promptTokenCount: 321, candidatesTokenCount: 50, thoughtsTokenCount: 20 } }), { status: 200 }))
    : origFetch(input, init);
  try { await ask('سؤال سري'); } finally { globalThis.fetch = origFetch; }
  await new Promise((r) => setTimeout(r, 5));
  eq(db.ai_usage_events.length, 1, 'حدث واحد');
  eq([db.ai_usage_events[0].model, db.ai_usage_events[0].input_tokens, db.ai_usage_events[0].output_tokens, db.ai_usage_events[0].plan_id, db.ai_usage_events[0].user_id], ['m1', 321, 70, 7, 'u1'], 'القيم');
  ok(!JSON.stringify(db.ai_usage_events).includes('سؤال سري'), 'مفيش محتوى');
});

Deno.test('تخصيص فردي أكبر من الخطة بيكسب', async () => {
  setup();
  table('ai_access')[0].daily_limit_override = 100;
  subscribe();
  eq((await status()).json.status.daily_limit, 100, 'الحد');
});

Deno.test('جداول الخطط لسه ماتعملتش (SQL ماتشغّلش): كله شغال زي الأول', async () => {
  setup();
  failTables.add('ai_subscriptions'); failTables.add('ai_plans'); failTables.add('ai_usage_events');
  const st = (await status()).json.status;
  eq([st.state, st.plan, st.daily_limit], ['ok', null, 5], 'status');
  eq((await ask('س')).json.reply, 'رد من m1', 'الرد');
});
