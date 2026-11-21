import {
  availableModels, blockedBody, buildContents, buildModelChain, cairoDayKey, cairoMonthKey, classifyGeminiFailure,
  computeStatus, cooldownUntil, effectiveDailyLimit, extractUsage, mergeModelChains, nextCairoMidnight, nextPacificMidnight,
  pickActivePlan, sanitizeHistory, sanitizeModelNames,
  buildSystemPrompt, GUARDRAILS, KNOWLEDGE_MAX, PERSONA_MAX, pickPromptText,
} from '../../supabase/functions/ai-assistant/ai-core.ts';
import { eq, ok } from './assert.ts';

const f429 = await Deno.readTextFile(new URL('./fixtures/gemini_429_daily.json', import.meta.url));
const f503 = await Deno.readTextFile(new URL('./fixtures/gemini_503.json', import.meta.url));

Deno.test('اليوم بتوقيت القاهرة (شتا +٢ وصيف +٣)', () => {
  eq(cairoDayKey(new Date('2026-11-14T22:30:00Z')), '2026-11-15', 'شتا: ٠٠:٣٠ بالقاهرة = اليوم اللي بعده');
  eq(cairoDayKey(new Date('2026-11-14T21:30:00Z')), '2026-11-14', 'شتا: ٢٣:٣٠ بالقاهرة لسه نفس اليوم');
  eq(cairoDayKey(new Date('2026-06-14T21:30:00Z')), '2026-06-15', 'صيف: ٠٠:٣٠ بالقاهرة');
  eq(cairoMonthKey(new Date('2026-11-30T22:30:00Z')), '2026-12', 'الشهر بيتغيّر بتوقيت القاهرة');
});

Deno.test('منتصف الليل الجاي بالقاهرة وجوجل', () => {
  eq(nextCairoMidnight(new Date('2026-11-14T12:00:00Z')).toISOString(), '2026-11-14T22:00:00.000Z', 'القاهرة شتا');
  // نفس اللحظة اللي ظهرت في لوج الإنتاج: ١٣:٤٣:٢٧ UTC + ١٧س٥٩د٢٥ = ٠٨:٠٣ ≈ منتصف الليل بتوقيت المحيط الهادي
  eq(nextPacificMidnight(new Date('2026-11-14T13:43:27Z')).toISOString(), '2026-11-15T08:00:00.000Z', 'جوجل: ٠٨:٠٠ UTC = ١٠ الصبح بالقاهرة');
  // خاصية عامة على كل السنة (بما فيها تغيير التوقيت الصيفي): التالي بعد الآن وخلال ٢٥ ساعة وبيبدأ يوم جديد
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 6 * 3600 * 1000 + 777_000) {
    const d = new Date(t), n = nextCairoMidnight(d);
    ok(n.getTime() > d.getTime() && n.getTime() - d.getTime() <= 25 * 3600 * 1000, `مدى غلط عند ${d.toISOString()}`);
    ok(cairoDayKey(n) !== cairoDayKey(d), `نفس اليوم عند ${d.toISOString()}`);
  }
});

Deno.test('تصنيف الأخطاء من لوج الإنتاج الحقيقي', () => {
  const daily = classifyGeminiFailure(429, f429);
  eq(daily.kind, 'quota_daily', '٤٢٩ يومي');
  eq(daily.retryAfterSec, 64765, 'وقت الانتظار من RetryInfo');
  eq(classifyGeminiFailure(503, f503).kind, 'overloaded', '٥٠٣');
  eq(classifyGeminiFailure(0, 'timeout').kind, 'timeout', 'مهلة');
  eq(classifyGeminiFailure(404, '{"error":{"message":"models/x is not found"}}').kind, 'bad_model', 'موديل مش موجود');
  eq(classifyGeminiFailure(403, '{"error":{"message":"API key not valid"}}').kind, 'auth', 'مفتاح');
  eq(classifyGeminiFailure(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}').kind, 'auth', '٤٠٠ مفتاح');
  eq(classifyGeminiFailure(400, '{"error":{"message":"bad field"}}').kind, 'bad_request', '٤٠٠ عادي');
  // ٤٢٩ بدون تفاصيل: الرسالة بس
  const msgOnly = classifyGeminiFailure(429, JSON.stringify({ error: { message: 'Quota exceeded, per day limit. Please retry in 2h5m3.5s.', status: 'RESOURCE_EXHAUSTED' } }));
  eq(msgOnly.kind, 'quota_daily', 'يومي من النص');
  eq(msgOnly.retryAfterSec, 2 * 3600 + 5 * 60 + 3.5, 'وقت من النص');
  // ٤٢٩ دقيقة
  const minute = classifyGeminiFailure(429, JSON.stringify({ error: { message: 'x', status: 'RESOURCE_EXHAUSTED', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '31s' } ] } }));
  eq(minute.kind, 'quota_minute', 'دقيقة');
  eq(classifyGeminiFailure(429, 'not json').kind, 'quota_minute', '٤٢٩ من غير أي معلومة = مؤقت');
});

Deno.test('وقت رجوع الموديل بعد الفشل', () => {
  const now = new Date('2026-11-14T13:43:27Z');
  eq(cooldownUntil(classifyGeminiFailure(429, f429), now)?.toISOString(), new Date(now.getTime() + 64770_000).toISOString(), 'يومي: الوقت اللي جوجل قالته');
  eq(cooldownUntil({ kind: 'quota_daily', detail: '' }, now)?.toISOString(), '2026-11-15T08:00:00.000Z', 'يومي من غير وقت: منتصف ليل جوجل');
  eq(cooldownUntil({ kind: 'quota_minute', retryAfterSec: 5, detail: '' }, now)?.getTime(), now.getTime() + 30_000, 'دقيقة: حد أدنى ٣٠ ثانية');
  eq(cooldownUntil({ kind: 'quota_minute', retryAfterSec: 9999, detail: '' }, now)?.getTime(), now.getTime() + 300_000, 'دقيقة: حد أقصى ٥ دقايق');
  eq(cooldownUntil({ kind: 'overloaded', detail: '' }, now)?.getTime(), now.getTime() + 30_000, 'ضغط: ٣٠ ثانية');
  eq(cooldownUntil({ kind: 'auth', detail: '' }, now), null, 'مفتاح: مفيش تخطّي');
  eq(cooldownUntil({ kind: 'bad_request', detail: '' }, now), null, '٤٠٠: مفيش تخطّي');
});

Deno.test('سلسلة الموديلات', () => {
  eq(buildModelChain('a-1', ['b-2', 'a-1', 'c.3', ' models/d-4 ', 'مش صالح', 7, '../x']), ['a-1', 'b-2', 'c.3', 'd-4'], 'ترتيب وتنضيف وتكرار');
  eq(buildModelChain(undefined, undefined), ['gemini-2.5-flash-lite'], 'افتراضي');
  eq(buildModelChain('p', ['1a', '2a', '3a', '4a', '5a', '6a']).length, 5, 'حد أقصى ٥');
  const now = new Date('2026-11-14T10:00:00Z');
  const cd = new Map([['m1', { until: new Date('2026-11-14T18:00:00Z'), reason: 'quota_daily' }], ['m2', { until: new Date('2026-11-14T09:00:00Z'), reason: 'quota_daily' }]]);
  const r = availableModels(['m1', 'm2', 'm3'], cd, now);
  eq(r.available, ['m2', 'm3'], 'اللي انتهت فترته بقى متاح');
  const all = availableModels(['m1'], cd, now);
  eq([all.available.length, all.allQuota, all.earliestRetry?.toISOString()], [0, true, '2026-11-14T18:00:00.000Z'], 'كلهم خالصين بسبب الحصة');
  const mixed = availableModels(['m1', 'm4'], new Map([...cd, ['m4', { until: new Date('2026-11-14T10:00:30Z'), reason: 'overloaded' }]]), now);
  eq(mixed.allQuota, false, 'واحد منهم ضغط مش حصة');
});

Deno.test('تنضيف history', () => {
  eq(sanitizeHistory('x'), [], 'مش مصفوفة');
  eq(sanitizeHistory([{ role: 'user', text: 'س١' }, { role: 'bot', text: 'ج١' }, { role: 'user', text: 'س٢' }, { role: 'model', text: 'ج٢' }]),
    [{ role: 'user', text: 'س١' }, { role: 'model', text: 'ج١' }, { role: 'user', text: 'س٢' }, { role: 'model', text: 'ج٢' }], 'bot → model');
  eq(sanitizeHistory([{ role: 'model', text: 'تائه' }, { role: 'user', text: 'س' }, { role: 'model', text: 'ج' }, { role: 'user', text: 'معلّق' }]),
    [{ role: 'user', text: 'س' }, { role: 'model', text: 'ج' }], 'بيبدأ بسؤال وبينتهي برد');
  eq(sanitizeHistory([{ role: 'user', text: 'أ' }, { role: 'user', text: 'ب' }, { role: 'model', text: 'ج' }]), [{ role: 'user', text: 'ب' }, { role: 'model', text: 'ج' }], 'دورين ورا بعض');
  eq(sanitizeHistory([{ role: 'admin', text: 'x' }, { role: 'user', text: '   ' }, null, 5, { role: 'user' }]), [], 'قيم مش صالحة');
  const big = sanitizeHistory(Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 'ع'.repeat(2000) })));
  ok(big.length <= 4 && big.every((e) => e.text.length <= 1500), 'قص النصوص والحجم الإجمالي');
  eq(sanitizeHistory(Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: `m${i}` }))).length <= 8, true, 'آخر ٨ بس');
  const contents = buildContents([{ role: 'user', text: 'س' }, { role: 'model', text: 'ج' }], 'جديد');
  eq(contents.map((c) => c.role), ['user', 'model', 'user'], 'السؤال الجديد في الآخر');
});

Deno.test('حالة الطالب والأولوية بين الأسباب', () => {
  const base = { globalEnabled: true, userEnabled: true, dailyLimit: 5, usedToday: 2, monthlyLimit: 3000, monthlyCount: 10, modelsAvailable: true, modelsRetryAt: null, now: new Date('2026-11-14T12:00:00Z') };
  const ok1 = computeStatus(base);
  eq([ok1.state, ok1.available, ok1.remaining_today, ok1.resets_at], ['ok', true, 3, '2026-11-14T22:00:00.000Z'], 'تمام');
  eq(computeStatus({ ...base, globalEnabled: false, userEnabled: false }).state, 'feature_off', 'الميزة واقفة أولًا');
  eq(computeStatus({ ...base, userEnabled: false }).state, 'not_enabled', 'مش مفعّل');
  eq(computeStatus({ ...base, usedToday: 5 }).state, 'daily_limit', 'خلّص يومه');
  eq(computeStatus({ ...base, usedToday: 9 }).remaining_today, 0, 'مفيش سالب');
  eq(computeStatus({ ...base, monthlyCount: 3000 }).state, 'monthly_limit', 'الشهري');
  const ex = computeStatus({ ...base, modelsAvailable: false, modelsRetryAt: new Date('2026-11-15T08:00:00Z') });
  eq([ex.state, ex.retry_at], ['models_exhausted', '2026-11-15T08:00:00.000Z'], 'الموديلات خلصت');
  eq(computeStatus({ ...base, usedToday: 5, modelsAvailable: false }).state, 'daily_limit', 'الحد اليومي قبل الموديلات');
  const b = blockedBody('not_enabled', { x: 1 });
  eq([b.blocked, b.code, typeof b.reason, b.x], [true, 'not_enabled', 'string', 1], 'شكل رد الحظر (reason للنسخ القديمة)');
});

Deno.test('الخطة الفعّالة للطالب', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const plans = [{ id: 1, name: 'أساسية', daily_limit: 20, models: ['m-a'] }, { id: 2, name: 'متفوق', daily_limit: 50, models: null }, { id: 3, name: 'صفر', daily_limit: 0 }];
  const sub = (plan_id: number, over: Record<string, unknown> = {}) => ({ plan_id, status: 'active', starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-18T12:00:00Z', ...over });
  eq(pickActivePlan([], plans, now), null, 'من غير اشتراكات');
  const p = pickActivePlan([sub(1)], plans, now)!;
  eq([p.name, p.dailyLimit, p.models, p.daysLeft, p.endsAt?.toISOString()], ['أساسية', 20, ['m-a'], 3, '2026-11-18T12:00:00.000Z'], 'اشتراك عادي');
  eq(pickActivePlan([sub(1, { ends_at: '2026-11-15T12:00:00Z' })], plans, now), null, 'انتهى بالظبط دلوقتي');
  eq(pickActivePlan([sub(1, { ends_at: '2026-11-15T11:59:59Z' })], plans, now), null, 'منتهي');
  eq(pickActivePlan([sub(1, { status: 'cancelled' })], plans, now), null, 'ملغي');
  eq(pickActivePlan([sub(1, { starts_at: '2026-11-16T00:00:00Z' })], plans, now), null, 'لسه مبدأش');
  eq(pickActivePlan([sub(99)], plans, now), null, 'خطة مش موجودة');
  eq(pickActivePlan([sub(3)], plans, now), null, 'خطة بحد صفر');
  eq(pickActivePlan([sub(1), sub(2)], plans, now)?.name, 'متفوق', 'أكبر حد يومي');
  eq(pickActivePlan([sub(2, { ends_at: '2026-11-20T00:00:00Z' }), sub(2, { ends_at: null })], plans, now)?.daysLeft, null, 'نفس الحد: اللي من غير نهاية الأول');
  eq(pickActivePlan([sub(1, { ends_at: '2026-11-15T13:00:00Z' })], plans, now)?.daysLeft, 1, 'أقل من يوم = يوم');
  eq(sanitizeModelNames(['a-1', 'مش صالح', 'a-1', 5, ' models/b-2 ']), ['a-1', 'b-2'], 'تنضيف أسماء موديلات الخطة');
});

Deno.test('الحد اليومي والموديلات والتوكنز', () => {
  eq(effectiveDailyLimit({ override: null, planLimit: null, defaultLimit: 5 }), 5, 'افتراضي');
  eq(effectiveDailyLimit({ override: 9, planLimit: null, defaultLimit: 5 }), 9, 'تخصيص فردي');
  eq(effectiveDailyLimit({ override: null, planLimit: 30, defaultLimit: 5 }), 30, 'خطة');
  eq(effectiveDailyLimit({ override: 3, planLimit: 30, defaultLimit: 5 }), 30, 'تخصيص قديم صغير مبيقيّدش حد دافع');
  eq(effectiveDailyLimit({ override: 100, planLimit: 30, defaultLimit: 5 }), 100, 'تخصيص أكبر من الخطة بيكسب');
  eq(mergeModelChains(['p1', 'g1'], ['g1', 'g2']), ['p1', 'g1', 'g2'], 'موديلات الخطة الأول ثم العامة من غير تكرار');
  eq(mergeModelChains([], ['g1']), ['g1'], 'خطة من غير موديلات');
  eq(extractUsage({ usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 80, thoughtsTokenCount: 40 } }), { input: 120, output: 120 }, 'التفكير بيتحسب إخراج');
  eq(extractUsage({}), { input: 0, output: 0 }, 'من غير بيانات');
  eq(extractUsage({ usageMetadata: { promptTokenCount: 'x', candidatesTokenCount: -5 } }), { input: 0, output: 0 }, 'قيم غريبة');
});

Deno.test('الحالة مع خطة: بتفعّل، وبتتخطّى السقف الشهري، وفيها بيانات الخطة', () => {
  const base = { globalEnabled: true, userEnabled: true, dailyLimit: 30, usedToday: 1, monthlyLimit: 100, monthlyCount: 100, modelsAvailable: true, modelsRetryAt: null, now: new Date('2026-11-15T12:00:00Z') };
  eq(computeStatus(base).state, 'monthly_limit', 'من غير خطة: السقف الشهري بيحظر');
  const plan = { id: 2, name: 'متفوق', dailyLimit: 30, models: [], endsAt: new Date('2026-11-18T12:00:00Z'), daysLeft: 3 };
  const s = computeStatus({ ...base, plan });
  eq([s.state, s.plan?.name, s.plan?.days_left, s.plan?.ends_at], ['ok', 'متفوق', 3, '2026-11-18T12:00:00.000Z'], 'المشترك مبيتأثرش بالسقف الشهري');
  eq(computeStatus({ ...base, plan, usedToday: 30 }).state, 'daily_limit', 'حد الخطة اليومي لسه شغال');
  eq(computeStatus({ ...base, monthlyCount: 0 }).plan, null, 'من غير خطة: plan = null');
});

Deno.test('برومبت النظام: الشخصية ثم المعرفة ثم القواعد الثابتة في الآخر', () => {
  const p = buildSystemPrompt('شخصية-س', 'معرفة-ص');
  ok(p.startsWith('شخصية-س'), 'الشخصية الأول');
  ok(p.indexOf('معرفة-ص') > p.indexOf('شخصية-س'), 'المعرفة بعدها');
  ok(p.endsWith(GUARDRAILS), 'القواعد الثابتة في الآخر');
  ok(p.indexOf(GUARDRAILS) > p.indexOf('معرفة-ص'), 'القواعد بعد المعرفة');
});

Deno.test('نص الإعدادات: الفاضي والغلط والطويل بيرجع للافتراضي', () => {
  eq(pickPromptText('  نص  ', 10, 'افتراضي'), 'نص', 'بيتنضّف');
  eq(pickPromptText('', 10, 'افتراضي'), 'افتراضي', 'فاضي');
  eq(pickPromptText('   ', 10, 'افتراضي'), 'افتراضي', 'مسافات بس');
  eq(pickPromptText(null, 10, 'افتراضي'), 'افتراضي', 'null');
  eq(pickPromptText(42, 10, 'افتراضي'), 'افتراضي', 'مش نص');
  eq(pickPromptText('x'.repeat(11), 10, 'افتراضي'), 'افتراضي', 'أطول من الحد');
  eq(pickPromptText('x'.repeat(10), 10, 'افتراضي'), 'x'.repeat(10), 'على الحد بالظبط');
  ok(PERSONA_MAX === 3000 && KNOWLEDGE_MAX === 4000, 'الحدود');
});
