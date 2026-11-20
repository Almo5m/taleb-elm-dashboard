import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSubscriptionOf, cairoDayStartIso, canDeletePlan, countByPlan, estimateCost, formatCairoDate, planChanges, filterSubscriptions, isExpiringSoon, lastMonths, monthlySeries, planDeleteMessage,
  pricingToRows, renewalStart, reorderedPlans, tabCounts, validatePlanForm, validatePricing, validateSubscriptionForm, daysLeft,
} from '../../src/lib/aiPlans.js';

const goodPlan = { name: 'المتفوق', description: 'وصف', daily_limit: '30', duration_days: '30', price_egp: '50', models: ['gemini-3.5-flash'], is_active: true };

test('فحص الخطة: الحالة السليمة والـ payload', () => {
  const { error, payload } = validatePlanForm(goodPlan);
  assert.equal(error, null);
  assert.deepEqual(payload, { name: 'المتفوق', description: 'وصف', daily_limit: 30, duration_days: 30, price_egp: 50, models: ['gemini-3.5-flash'], is_active: true });
});

test('فحص الخطة: الفاضي المسموح (مدة وسعر ووصف وموديلات)', () => {
  const { error, payload } = validatePlanForm({ ...goodPlan, description: '  ', duration_days: '', price_egp: '', models: [] });
  assert.equal(error, null);
  assert.equal(payload.description, null);
  assert.equal(payload.duration_days, null);
  assert.equal(payload.price_egp, null);
});

test('فحص الخطة: كل حد بيترفض برسالة', () => {
  const bad = (patch) => validatePlanForm({ ...goodPlan, ...patch }).error;
  assert.match(bad({ name: '   ' }), /اسم/);
  assert.match(bad({ name: 'x'.repeat(61) }), /60/);
  assert.match(bad({ description: 'x'.repeat(201) }), /200/);
  for (const v of ['', '0', '1001', '-5', '2.5', 'abc']) assert.match(bad({ daily_limit: v }), /الحد اليومي/, v);
  for (const v of ['0', '3661', '1.5', 'x']) assert.match(bad({ duration_days: v }), /المدة/, v);
  for (const v of ['-1', 'abc', '1.234', '1e3']) assert.match(bad({ price_egp: v }), /السعر/, v);
  assert.match(bad({ models: ['bad name'] }), /bad name/);
  assert.match(bad({ models: ['a-a', 'a-a'] }), /متكرر/);
  assert.equal(validatePlanForm({ ...goodPlan, daily_limit: '1000' }).error, null);
  assert.equal(validatePlanForm({ ...goodPlan, daily_limit: '1' }).error, null);
  assert.equal(validatePlanForm({ ...goodPlan, duration_days: '3660' }).error, null);
  assert.equal(validatePlanForm({ ...goodPlan, price_egp: '0' }).error, null);
  assert.equal(validatePlanForm({ ...goodPlan, price_egp: '49.5' }).payload.price_egp, 49.5);
});

test('رسالة مسح خطة عليها اشتراكات', () => {
  assert.match(planDeleteMessage({ code: '23503' }), /اخفِها/);
  assert.equal(planDeleteMessage({ code: '42501' }), null);
  assert.equal(planDeleteMessage(null), null);
});

test('ترتيب الخطط: بيرجّع اللي اتغيّر بس', () => {
  const plans = [{ id: 1, sort_order: 1 }, { id: 2, sort_order: 2 }, { id: 3, sort_order: 3 }];
  assert.deepEqual(reorderedPlans(plans, 1, -1), [{ id: 2, sort_order: 1 }, { id: 1, sort_order: 2 }]);
  assert.deepEqual(reorderedPlans(plans, 0, -1), []);
  assert.deepEqual(reorderedPlans(plans, 2, 1), []);
  // كلهم sort_order = 0 (الافتراضي): التحريك بيطبّع الأرقام
  const zeros = [{ id: 1, sort_order: 0 }, { id: 2, sort_order: 0 }];
  assert.deepEqual(reorderedPlans(zeros, 1, -1), [{ id: 2, sort_order: 1 }, { id: 1, sort_order: 2 }]);
});

const NOW = Date.parse('2026-11-18T12:00:00Z');
const day = (n) => new Date(NOW + n * 86400000).toISOString();
const rows = [
  { id: 1, user_id: 'u1', student_name: 'أحمد علي', effective_status: 'active', ends_at: day(3) },
  { id: 2, user_id: 'u2', student_name: 'منى', effective_status: 'active', ends_at: day(20) },
  { id: 3, user_id: 'u3', student_name: 'كريم', effective_status: 'active', ends_at: null },
  { id: 4, user_id: 'u4', student_name: 'سارة', effective_status: 'scheduled', ends_at: day(40) },
  { id: 5, user_id: 'u5', student_name: 'يوسف', effective_status: 'expired', ends_at: day(-2) },
  { id: 6, user_id: 'u6', student_name: 'هدى', effective_status: 'cancelled', ends_at: day(5) },
  { id: 7, user_id: 'u1', student_name: 'أحمد علي', effective_status: 'active', ends_at: day(40) },
];

test('التبويبات والعدّادات', () => {
  assert.deepEqual(tabCounts(rows, NOW), { active: 5, expiring: 1, expired: 1, cancelled: 1 });
  assert.ok(isExpiringSoon(rows[0], NOW));
  assert.ok(!isExpiringSoon(rows[2], NOW)); // مفتوح
  assert.ok(!isExpiringSoon(rows[5], NOW)); // ملغي حتى لو تاريخه قريب
  assert.ok(!isExpiringSoon({ effective_status: 'active', ends_at: day(7.01) }, NOW));
  assert.ok(isExpiringSoon({ effective_status: 'active', ends_at: day(7) }, NOW));
  assert.ok(!isExpiringSoon({ effective_status: 'active', ends_at: day(-0.1) }, NOW));
});

test('البحث بالاسم', () => {
  assert.deepEqual(filterSubscriptions(rows, 'active', 'احمد', NOW).length, 0); // الهمزة مختلفة، مطابقة حرفية
  assert.deepEqual(filterSubscriptions(rows, 'active', 'أحمد', NOW).map((r) => r.id), [1, 7]);
  assert.deepEqual(filterSubscriptions(rows, 'active', '  ', NOW).length, 5);
  assert.deepEqual(filterSubscriptions(rows, 'expired', '', NOW).map((r) => r.id), [5]);
});

test('اشتراك الطالب الفعّال: اللي ينتهي أبعد، والمفتوح يكسب', () => {
  assert.equal(activeSubscriptionOf(rows, 'u1', NOW).id, 7);
  assert.equal(activeSubscriptionOf(rows, 'u3', NOW).id, 3);
  assert.equal(activeSubscriptionOf(rows, 'u5', NOW), null);
  assert.equal(activeSubscriptionOf(rows, 'u4', NOW), null); // مجدول مش فعّال
  assert.equal(activeSubscriptionOf([...rows, { id: 8, user_id: 'u2', effective_status: 'active', ends_at: null }], 'u2', NOW).id, 8);
  assert.equal(renewalStart(rows[0]), rows[0].ends_at);
  assert.equal(renewalStart(rows[2]), null);
  assert.equal(daysLeft(day(3), NOW), 3);
  assert.equal(daysLeft(null, NOW), null);
});

const plans = [{ id: 1, name: 'أ', price_egp: 50, duration_days: 30 }];
const goodSub = { userId: 'u9', planId: '1', startsAt: '2026-11-18T10:00', endsAt: '', amount: '50', note: 'فودافون كاش' };

test('فحص الاشتراك: السليم', () => {
  const { error, payload, plan } = validateSubscriptionForm(goodSub, plans);
  assert.equal(error, null);
  assert.equal(plan.id, 1);
  assert.equal(payload.ends_at, null);
  assert.equal(payload.amount_paid, 50);
  assert.equal(payload.payment_note, 'فودافون كاش');
  assert.equal(payload.user_id, 'u9');
  assert.ok(payload.starts_at.endsWith('Z'));
});

test('فحص الاشتراك: الرفض', () => {
  const bad = (patch) => validateSubscriptionForm({ ...goodSub, ...patch }, plans).error;
  assert.match(bad({ userId: '' }), /الطالب/);
  assert.match(bad({ planId: '' }), /الخطة/);
  assert.match(bad({ planId: '99' }), /الخطة/);
  assert.match(bad({ startsAt: 'nope' }), /البداية/);
  assert.match(bad({ endsAt: 'nope' }), /النهاية/);
  assert.match(bad({ endsAt: '2026-11-18T10:00' }), /بعد بدايته/);
  assert.match(bad({ endsAt: '2026-11-01T10:00' }), /بعد بدايته/);
  assert.match(bad({ amount: '-5' }), /المبلغ/);
  assert.match(bad({ amount: 'abc' }), /المبلغ/);
  assert.match(bad({ note: 'x'.repeat(301) }), /300/);
  assert.match(bad({ note: 'حوّل على 01012345678' }), /أرقام/);
  assert.match(bad({ note: 'حساب 1234 5678 9012' }), /أرقام/);
  assert.match(bad({ note: 'حساب 1234-5678-9012' }), /أرقام/);
  assert.match(bad({ note: 'حوّل على ٠١٠١٢٣٤٥٦٧٨' }), /أرقام/);
  assert.match(bad({ note: 'حوّل على ۰۱۰۱۲۳۴۵۶۷۸' }), /أرقام/);
  assert.equal(bad({ note: 'دفعة ٣ من 4' }), null); // أرقام قصيرة عادية
  assert.equal(bad({ note: '' }), null);
  assert.equal(bad({ amount: '' }), null);
  assert.equal(bad({ endsAt: '2026-12-18T10:00' }), null);
});

test('فحص الأسعار', () => {
  const ok = validatePricing({ usdToEgp: '50', rows: [{ model: 'gemini-3.5-flash-lite', input_per_m: '0.3', output_per_m: '2.5' }] });
  assert.equal(ok.error, null);
  assert.deepEqual(ok.value, { usd_to_egp: 50, models: { 'gemini-3.5-flash-lite': { input_per_m: 0.3, output_per_m: 2.5 } } });
  assert.match(validatePricing({ usdToEgp: '', rows: [] }).error, /الدولار/);
  assert.match(validatePricing({ usdToEgp: '0', rows: [] }).error, /الدولار/);
  assert.match(validatePricing({ usdToEgp: '50', rows: [{ model: '', input_per_m: '1', output_per_m: '1' }] }).error, /اسم/);
  assert.match(validatePricing({ usdToEgp: '50', rows: [{ model: 'bad name', input_per_m: '1', output_per_m: '1' }] }).error, /bad name/);
  assert.match(validatePricing({ usdToEgp: '50', rows: [{ model: 'a-a', input_per_m: '-1', output_per_m: '1' }] }).error, /الإدخال/);
  assert.match(validatePricing({ usdToEgp: '50', rows: [{ model: 'a-a', input_per_m: '1', output_per_m: '' }] }).error, /الإخراج/);
  assert.match(validatePricing({ usdToEgp: '50', rows: [{ model: 'a-a', input_per_m: '1', output_per_m: '1' }, { model: 'a-a', input_per_m: '1', output_per_m: '1' }] }).error, /متكرر/);
  assert.equal(validatePricing({ usdToEgp: '50', rows: [] }).error, null); // من غير موديلات مسموح
  assert.deepEqual(pricingToRows({ usd_to_egp: 50, models: { 'a-a': { input_per_m: 0.3, output_per_m: 2.5 } } }), [{ model: 'a-a', input_per_m: '0.3', output_per_m: '2.5' }]);
  assert.deepEqual(pricingToRows(null), []);
});

test('التكلفة التقديرية', () => {
  const pricing = { usd_to_egp: 50, models: { 'a-a': { input_per_m: 0.3, output_per_m: 2.5 } } };
  const tokens = [{ month: '2026-11', model: 'a-a', input_tokens: 2_000_000, output_tokens: 1_000_000 }];
  const r = estimateCost(tokens, pricing);
  assert.ok(Math.abs(r.usd - 3.1) < 1e-9);
  assert.ok(Math.abs(r.egp - 155) < 1e-9);
  assert.deepEqual(r.unpriced, []);
  // موديل من غير سعر: مبيتحسبش صفر
  const partial = estimateCost([...tokens, { model: 'zz-zz', input_tokens: 5, output_tokens: 5 }, { model: 'zz-zz', input_tokens: 1, output_tokens: 1 }], pricing);
  assert.deepEqual(partial.unpriced, ['zz-zz']);
  assert.ok(Math.abs(partial.usd - 3.1) < 1e-9);
  // سعر الدولار ناقص
  assert.equal(estimateCost(tokens, { models: pricing.models }).egp, null);
  assert.equal(estimateCost([], null).egp, null);
  assert.equal(estimateCost([], pricing).egp, 0);
  // bigint جاية نص من PostgREST
  assert.ok(Math.abs(estimateCost([{ model: 'a-a', input_tokens: '1000000', output_tokens: '0' }], pricing).usd - 0.3) < 1e-9);
});

test('آخر شهور بتوقيت القاهرة (بما فيها عبور السنة)', () => {
  assert.deepEqual(lastMonths(3, Date.parse('2026-11-18T12:00:00Z')), ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(lastMonths(3, Date.parse('2027-01-10T12:00:00Z')), ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(lastMonths(1, Date.parse('2026-11-30T23:30:00Z')), ['2026-12']); // ١:٣٠ صباح ١ ديسمبر بالقاهرة
  assert.equal(lastMonths(6, Date.parse('2026-02-15T12:00:00Z'))[0], '2025-09');
});

test('السلسلة الشهرية: دخل وتكلفة وصافي', () => {
  const pricing = { usd_to_egp: 50, models: { 'a-a': { input_per_m: 0.3, output_per_m: 2.5 } } };
  const out = monthlySeries(
    ['2026-10', '2026-11'],
    [{ month: '2026-11', revenue_egp: '500.00' }],
    [{ month: '2026-11', model: 'a-a', input_tokens: 2_000_000, output_tokens: 1_000_000 }],
    pricing,
  );
  assert.equal(out[0].revenue, 0);
  assert.equal(out[0].cost, 0);
  assert.equal(out[0].net, 0);
  assert.equal(out[1].revenue, 500);
  assert.ok(Math.abs(out[1].net - 345) < 1e-9);
  assert.equal(monthlySeries(['2026-11'], [], [], null)[0].net, null);
});

test('تغييرات الخطة للسجل: من غير تغيير وهمي', () => {
  const plan = { name: 'أ', description: null, daily_limit: 30, duration_days: null, price_egp: '50.00', models: ['a-a', 'b-b'], is_active: true };
  const same = { name: 'أ', description: null, daily_limit: 30, duration_days: null, price_egp: 50, models: ['a-a', 'b-b'], is_active: true };
  assert.deepEqual(planChanges(plan, same), {});
  assert.deepEqual(planChanges(plan, { ...same, description: '' }), {}); // null و'' نفس الشيء
  assert.deepEqual(planChanges(plan, { ...same, models: ['b-b', 'a-a'], price_egp: 60 }), {
    models: { from: 'a-a, b-b', to: 'b-b, a-a' },
    price_egp: { from: 50, to: 60 },
  });
  assert.deepEqual(planChanges(plan, { ...same, price_egp: null }), { price_egp: { from: 50, to: '' } });
  assert.deepEqual(planChanges(plan, { ...same, is_active: false }), { is_active: { from: true, to: false } });
});

test('تاريخ القاهرة', () => {
  assert.equal(formatCairoDate(null), '—');
  assert.equal(formatCairoDate('nope'), '—');
  // ١١:٣٠ مساءً UTC يوم ١٨ = ١:٣٠ صباح ١٩ بالقاهرة
  assert.match(formatCairoDate('2026-11-18T23:30:00Z'), /١٩|19/);
});

test('بداية يوم القاهرة', () => {
  // شتا (+٢): ١٢ ظهرًا UTC = ٢ ظهرًا بالقاهرة، فبداية اليوم ٢٢:٠٠ UTC اللي قبله
  assert.equal(cairoDayStartIso(Date.parse('2026-11-18T12:00:00Z')), '2026-11-17T22:00:00.000Z');
  // ٢٢:٣٠ UTC = ٠:٣٠ صباح اليوم الجاي بالقاهرة
  assert.equal(cairoDayStartIso(Date.parse('2026-11-18T22:30:00Z')), '2026-11-18T22:00:00.000Z');
  // صيف (+٣)
  assert.equal(cairoDayStartIso(Date.parse('2026-07-10T12:00:00.500Z')), '2026-07-09T21:00:00.000Z');
});

test('مسح الخطة: أي اشتراك في أي حالة بيمنع', () => {
  const all = [{ plan_id: 1, status: 'cancelled' }, { plan_id: 1, status: 'active' }, { plan_id: 2, status: 'cancelled' }];
  const counts = countByPlan(all);
  assert.deepEqual(counts, { 1: 2, 2: 1 });
  assert.equal(canDeletePlan(counts[1]), false);
  assert.equal(canDeletePlan(counts[2]), false); // ملغي بس، ولسه بيمنع
  assert.equal(canDeletePlan(counts[3]), true);
  assert.deepEqual(countByPlan(null), {});
});
