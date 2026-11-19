// منطق خطط واشتراكات بو والتكلفة التقديرية (نقي، من غير React ولا Supabase) عشان يتختبر لوحده.
// الحدود هنا هي نفسها قيود الجداول في sql/supabase_ai_plans.sql، فالسيرفر ميرفضش اللي الواجهة قبلته.

import { MAX_PLAN_MODELS, isValidModelName, validateModelList } from './aiModels.js';

export const PLAN_LIMITS = {
  nameMax: 60,
  descriptionMax: 200,
  dailyMin: 1,
  dailyMax: 1000,
  durationMin: 1,
  durationMax: 3660,
  priceMax: 99999999.99,
  noteMax: 300,
};

export const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRING_DAYS = 7;

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
const toInt = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN);
const toMoney = (v) => (/^\d+(\.\d{1,2})?$/.test(String(v).trim()) ? Number(v) : NaN);

/** الحقول الفاضية لنموذج خطة جديدة */
export const emptyPlanForm = () => ({
  name: '', description: '', daily_limit: '', duration_days: '', price_egp: '', models: [], is_active: true,
});

export const planToForm = (plan) => ({
  name: plan.name || '',
  description: plan.description || '',
  daily_limit: String(plan.daily_limit ?? ''),
  duration_days: plan.duration_days == null ? '' : String(plan.duration_days),
  price_egp: plan.price_egp == null ? '' : String(Number(plan.price_egp)),
  models: Array.isArray(plan.models) ? plan.models : [],
  is_active: plan.is_active !== false,
});

/** فحص نموذج الخطة. بيرجّع { error, payload } والـ payload جاهز للإدخال في ai_plans */
export function validatePlanForm(form, { primaryModel = '' } = {}) {
  const name = (form.name || '').trim();
  if (!name) return { error: 'اسم الخطة مطلوب', payload: null };
  if (name.length > PLAN_LIMITS.nameMax) return { error: `اسم الخطة أقصاه ${PLAN_LIMITS.nameMax} حرف`, payload: null };

  const description = (form.description || '').trim();
  if (description.length > PLAN_LIMITS.descriptionMax) {
    return { error: `الوصف أقصاه ${PLAN_LIMITS.descriptionMax} حرف`, payload: null };
  }

  const daily = toInt(form.daily_limit);
  if (!Number.isInteger(daily) || daily < PLAN_LIMITS.dailyMin || daily > PLAN_LIMITS.dailyMax) {
    return { error: `الحد اليومي لازم يكون رقم صحيح من ${PLAN_LIMITS.dailyMin} لـ ${PLAN_LIMITS.dailyMax}`, payload: null };
  }

  let duration = null;
  if (!isBlank(form.duration_days)) {
    duration = toInt(form.duration_days);
    if (!Number.isInteger(duration) || duration < PLAN_LIMITS.durationMin || duration > PLAN_LIMITS.durationMax) {
      return { error: `المدة لازم تكون عدد أيام صحيح من ${PLAN_LIMITS.durationMin} لـ ${PLAN_LIMITS.durationMax}، أو سيبها فاضية (بدون مدة)`, payload: null };
    }
  }

  let price = null;
  if (!isBlank(form.price_egp)) {
    price = toMoney(form.price_egp);
    if (Number.isNaN(price) || price > PLAN_LIMITS.priceMax) {
      return { error: 'السعر لازم يكون رقم موجب (لحد خانتين عشرية)، أو سيبه فاضي', payload: null };
    }
  }

  // موديلات الخطة: نفس فحص البدائل، بس الخطة مش ممنوع تحط الأساسي فيها
  const models = validateModelList(form.models, { primary: '', max: MAX_PLAN_MODELS });
  if (models.error) return { error: models.error, payload: null };

  return {
    error: null,
    payload: { name, description: description || null, daily_limit: daily, duration_days: duration, price_egp: price, models: models.cleaned, is_active: !!form.is_active },
  };
}

/** رسالة مفهومة لخطأ مسح الخطة (السيرفر بيرفض لو عليها اشتراكات) */
export function planDeleteMessage(error) {
  if (error?.code === '23503') return 'الخطة دي عليها اشتراكات، فمينفعش تتمسح. اخفِها بدل ما تمسحها (المشتركين فيها مش هيتأثروا).';
  return null;
}

/** الخطة بعد التحريك: ترتيب جديد sort_order لكل خطة اتغيّر ترتيبها (من ١) */
export function reorderedPlans(plans, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= plans.length || target < 0 || target >= plans.length) return [];
  const next = [...plans];
  [next[index], next[target]] = [next[target], next[index]];
  return next
    .map((plan, i) => ({ id: plan.id, sort_order: i + 1, changed: plan.sort_order !== i + 1 }))
    .filter((p) => p.changed)
    .map(({ id, sort_order }) => ({ id, sort_order }));
}

// ---------- الاشتراكات ----------

export const SUB_TABS = [
  { key: 'active', label: 'فعّالة' },
  { key: 'expiring', label: 'بتنتهي قريب' },
  { key: 'expired', label: 'منتهية' },
  { key: 'cancelled', label: 'ملغية' },
];

export const daysLeft = (endsAt, now = Date.now()) => {
  if (!endsAt) return null;
  const diff = new Date(endsAt).getTime() - now;
  return Number.isNaN(diff) ? null : Math.ceil(diff / DAY_MS);
};

/** الاشتراك ده فعّال وبينتهي خلال أسبوع؟ */
export function isExpiringSoon(row, now = Date.now()) {
  if (row.effective_status !== 'active' || !row.ends_at) return false;
  const left = new Date(row.ends_at).getTime() - now;
  return left > 0 && left <= EXPIRING_DAYS * DAY_MS;
}

/** الصف يظهر في التبويب ده؟ (الفعّالة بتشمل المجدولة، وبتنتهي قريب مجموعة فرعية من الفعّالة) */
export function matchesTab(row, tab, now = Date.now()) {
  switch (tab) {
    case 'active': return row.effective_status === 'active' || row.effective_status === 'scheduled';
    case 'expiring': return isExpiringSoon(row, now);
    case 'expired': return row.effective_status === 'expired';
    case 'cancelled': return row.effective_status === 'cancelled';
    default: return false;
  }
}

export function tabCounts(rows, now = Date.now()) {
  return Object.fromEntries(SUB_TABS.map((t) => [t.key, rows.filter((r) => matchesTab(r, t.key, now)).length]));
}

export function filterSubscriptions(rows, tab, query = '', now = Date.now()) {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => matchesTab(r, tab, now) && (!q || (r.student_name || '').toLowerCase().includes(q)));
}

/** اشتراك الطالب الفعّال حاليًا (لو فيه أكتر من واحد: اللي ينتهي أبعد، والمفتوح الأبعد) */
export function activeSubscriptionOf(rows, userId, now = Date.now()) {
  const mine = rows.filter((r) => r.user_id === userId && r.effective_status === 'active');
  if (mine.length === 0) return null;
  const endOf = (r) => (r.ends_at ? new Date(r.ends_at).getTime() : Infinity);
  return mine.reduce((best, r) => (endOf(r) > endOf(best) ? r : best));
}

// أرقام تليفونات أو حسابات بنكية: ٨ أرقام ورا بعض (مع مسافات أو شرط)
const SENSITIVE_NUMBER_RE = /\d[\d\s-]{6,}\d/;
// الأرقام العربية والفارسية بتتحوّل لإنجليزي قبل الفحص، وإلا الرقم المكتوب ٠١٠... يعدّي
const toAsciiDigits = (text) => text.replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x0660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x06f0);

/**
 * فحص نموذج تفعيل اشتراك.
 * form: { userId, planId, startsAt, endsAt, amount, note } (التواريخ نصوص datetime-local أو ISO)
 */
export function validateSubscriptionForm(form, plans = []) {
  if (!form.userId) return { error: 'اختار الطالب', payload: null };
  const plan = plans.find((p) => String(p.id) === String(form.planId));
  if (!plan) return { error: 'اختار الخطة', payload: null };

  const startsAt = isBlank(form.startsAt) ? new Date() : new Date(form.startsAt);
  if (Number.isNaN(startsAt.getTime())) return { error: 'تاريخ البداية مش صحيح', payload: null };

  let endsAt = null;
  if (!isBlank(form.endsAt)) {
    endsAt = new Date(form.endsAt);
    if (Number.isNaN(endsAt.getTime())) return { error: 'تاريخ النهاية مش صحيح', payload: null };
    if (endsAt <= startsAt) return { error: 'نهاية الاشتراك لازم تكون بعد بدايته', payload: null };
  }

  let amount = null;
  if (!isBlank(form.amount)) {
    amount = toMoney(form.amount);
    if (Number.isNaN(amount) || amount > PLAN_LIMITS.priceMax) return { error: 'المبلغ المدفوع لازم يكون رقم موجب (لحد خانتين عشرية)', payload: null };
  }

  const note = (form.note || '').trim();
  if (note.length > PLAN_LIMITS.noteMax) return { error: `الملاحظة أقصاها ${PLAN_LIMITS.noteMax} حرف`, payload: null };
  if (SENSITIVE_NUMBER_RE.test(toAsciiDigits(note))) {
    return { error: 'متكتبش أرقام تليفونات أو حسابات في الملاحظة. اكتب وسيلة الدفع بس (مثلًا: فودافون كاش).', payload: null };
  }

  return {
    error: null,
    plan,
    payload: {
      user_id: form.userId,
      plan_id: plan.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null, // فاضي: السيرفر بيحسبها من مدة الخطة
      amount_paid: amount,
      payment_note: note || null,
    },
  };
}

/** بداية التجديد = نهاية الاشتراك الحالي (null لو الحالي مفتوح، يعني مفيش حاجة تتجدد بعدها) */
export const renewalStart = (current) => (current?.ends_at ? current.ends_at : null);

/** قيمة input من نوع datetime-local بتوقيت الجهاز */
export function toLocalInputValue(value = new Date()) {
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** رقم للعرض بالجنيه */
export const formatEgp = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ج`;
};

// ---------- أسعار الموديلات والتكلفة التقديرية ----------

export const EMPTY_PRICING = { usd_to_egp: '', models: {} };

/** فحص إعداد ai_pricing قبل الحفظ. rows: [{ model, input_per_m, output_per_m }] */
export function validatePricing({ usdToEgp, rows }) {
  const rate = Number(usdToEgp);
  if (isBlank(usdToEgp) || !Number.isFinite(rate) || rate <= 0) return { error: 'سعر الدولار بالجنيه لازم يكون رقم أكبر من صفر', value: null };
  const models = {};
  for (const row of rows) {
    const name = (row.model || '').trim();
    if (!name) return { error: 'فيه سطر من غير اسم موديل', value: null };
    if (!isValidModelName(name)) return { error: `"${name}": اسم موديل مش صحيح (حروف إنجليزية وأرقام ونقطة وشرطة)`, value: null };
    if (models[name]) return { error: `"${name}" متكرر`, value: null };
    const input = Number(row.input_per_m);
    const output = Number(row.output_per_m);
    if (isBlank(row.input_per_m) || !Number.isFinite(input) || input < 0) return { error: `"${name}": سعر الإدخال لازم يكون رقم صفر أو أكتر`, value: null };
    if (isBlank(row.output_per_m) || !Number.isFinite(output) || output < 0) return { error: `"${name}": سعر الإخراج لازم يكون رقم صفر أو أكتر`, value: null };
    models[name] = { input_per_m: input, output_per_m: output };
  }
  return { error: null, value: { usd_to_egp: rate, models } };
}

export function pricingToRows(pricing) {
  const models = pricing && typeof pricing.models === 'object' && pricing.models ? pricing.models : {};
  return Object.entries(models).map(([model, p]) => ({ model, input_per_m: String(p?.input_per_m ?? ''), output_per_m: String(p?.output_per_m ?? '') }));
}

/**
 * التكلفة التقديرية لشهر من ai_token_usage_monthly.
 * الموديل اللي مالوش سعر مبيتحسبش صفر: بيتحط في unpriced والتكلفة تبقى ناقصة.
 */
export function estimateCost(tokenRows, pricing) {
  const rate = Number(pricing?.usd_to_egp);
  const prices = pricing?.models || {};
  let usd = 0;
  const unpriced = [];
  for (const row of tokenRows) {
    const p = prices[row.model];
    if (!p) { unpriced.push(row.model); continue; }
    usd += (Number(row.input_tokens) * Number(p.input_per_m) + Number(row.output_tokens) * Number(p.output_per_m)) / 1_000_000;
  }
  const hasRate = Number.isFinite(rate) && rate > 0;
  return { usd, egp: hasRate ? usd * rate : null, unpriced: [...new Set(unpriced)], hasRate };
}

/** آخر n شهور بصيغة YYYY-MM بتوقيت القاهرة (الأقدم الأول) */
export function lastMonths(n, now = Date.now()) {
  const cairoMonth = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }).slice(0, 7);
  const [y, m] = cairoMonth(now).split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

/** دخل وتكلفة وصافي لكل شهر. التكلفة null لو مفيش سعر دولار */
export function monthlySeries(months, revenueRows, tokenRows, pricing) {
  return months.map((month) => {
    const revenue = Number(revenueRows.find((r) => r.month === month)?.revenue_egp) || 0;
    const cost = estimateCost(tokenRows.filter((r) => r.month === month), pricing);
    return { month, revenue, cost: cost.egp, unpriced: cost.unpriced, net: cost.egp === null ? null : revenue - cost.egp };
  });
}

// ---------- عرض وسجل النشاط ----------

/** تاريخ بتوقيت القاهرة بالعربي (من غير وقت) */
export function formatCairoDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * الحقول اللي اتغيّرت في خطة بين المحفوظ والـ payload الجديد (للسجل).
 * diffFields العامة بتقارن بالمرجع، فالمصفوفات (models) كانت هتطلع "اتغيّرت" دايمًا، والـ null بيختلف عن النص الفاضي.
 */
export function planChanges(plan, payload) {
  const norm = (key, v) => {
    if (key === 'models') return (Array.isArray(v) ? v : []).join(', ');
    if (key === 'price_egp') return v == null || v === '' ? '' : Number(v);
    return v ?? '';
  };
  const changes = {};
  for (const key of Object.keys(payload)) {
    const from = norm(key, plan?.[key]);
    const to = norm(key, payload[key]);
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
}

/**
 * بداية اليوم بتوقيت القاهرة (ISO). بتتحسب من ساعة القاهرة الحالية، فالدقة بتختلف ساعة واحدة
 * في يومين بس في السنة (يوم تغيير التوقيت الصيفي). كفاية لعدّاد "النهارده" في الرئيسية.
 */
export function cairoDayStartIso(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  const sinceMidnightMs = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + (now % 1000);
  return new Date(now - sinceMidnightMs).toISOString();
}
