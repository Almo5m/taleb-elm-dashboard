// منطق موديلات بو (نقي، من غير React ولا Supabase) عشان يتختبر لوحده.
// القواعد هنا لازم تطابق supabase/functions/ai-assistant/ai-core.ts (MODEL_NAME_RE و buildModelChain):
// لو اختلفت، الدالة هتتجاهل اسم الموديل بصمت والأدمن يفتكره اتحفظ.

// نفس الشرط في الدالة: حروف إنجليزية وأرقام ونقطة وشرطة وشرطة سفلية، من ٢ لـ ٦١ حرف
export const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,60}$/i;

// أقصى طول لسلسلة الموديلات العامة (الأساسي + البدائل). الدالة بتقص أي حاجة بعده.
export const MAX_CHAIN = 5;
// موديلات الخطة الواحدة بتتدمج مع السلسلة العامة بحد أقصى ٦ في الدالة
export const MAX_PLAN_MODELS = 6;

export const REASON_LABEL = {
  quota_daily: 'الحصة اليومية خلصت',
  quota_minute: 'حد الدقيقة',
  overloaded: 'جوجل تحت ضغط',
  timeout: 'الطلب اتأخر',
  bad_model: 'اسم الموديل غلط أو اتشال',
};

export const normalizeModelName = (value) => (typeof value === 'string' ? value.trim().replace(/^models\//, '') : '');

export const isValidModelName = (value) => MODEL_NAME_RE.test(normalizeModelName(value));

/** رسالة مشكلة اسم موديل واحد (أو null لو سليم) */
export function modelNameProblem(value) {
  const name = normalizeModelName(value);
  if (!name) return 'اسم الموديل فاضي';
  if (!MODEL_NAME_RE.test(name)) return 'اسم الموديل: حروف إنجليزية وأرقام ونقطة وشرطة بس (مثلًا gemini-3.5-flash-lite)';
  return null;
}

/**
 * فحص قايمة موديلات (بدائل أو موديلات خطة) قبل الحفظ.
 * primary: الموديل الأساسي، البديل ما ينفعش يبقى هو. max: أقصى عدد في القايمة دي.
 * بيرجّع { error, cleaned } والـ cleaned الأسماء بعد التنضيف.
 */
export function validateModelList(list, { primary = '', max = MAX_CHAIN - 1 } = {}) {
  const cleaned = [];
  const base = normalizeModelName(primary);
  for (const raw of Array.isArray(list) ? list : []) {
    const problem = modelNameProblem(raw);
    if (problem) return { error: `"${String(raw).trim()}": ${problem}`, cleaned };
    const name = normalizeModelName(raw);
    if (base && name === base) return { error: `"${name}" هو الموديل الأساسي، مينفعش يتكرر في القايمة`, cleaned };
    if (cleaned.includes(name)) return { error: `"${name}" متكرر في القايمة`, cleaned };
    cleaned.push(name);
  }
  if (cleaned.length > max) return { error: `أقصى عدد ${max} موديل في القايمة دي`, cleaned };
  return { error: null, cleaned };
}

/** تحريك عنصر خطوة لفوق (-1) أو لتحت (+1) من غير ما يعدّل القايمة الأصلية */
export function moveItem(list, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** سلسلة الموديلات اللي الدالة هتجرّبها بالترتيب (الأساسي ثم البدائل، من غير تكرار) */
export function buildChain(primary, fallbacks, defaultModel = 'gemini-2.5-flash-lite', max = MAX_CHAIN) {
  const out = [];
  const add = (v) => {
    const name = normalizeModelName(v);
    if (MODEL_NAME_RE.test(name) && !out.includes(name)) out.push(name);
  };
  add(primary || defaultModel);
  if (Array.isArray(fallbacks)) fallbacks.forEach(add);
  return out.slice(0, max);
}

// صفوف ai_model_state اللي بتبدأ بـ __ حالات تنبيه داخلية مش موديلات
export const isInternalStateRow = (row) => typeof row?.model === 'string' && row.model.startsWith('__');

/**
 * حالة كل موديل في السلسلة دلوقتي.
 * الموديل متاح لو مفيش صف له، أو exhausted_until فاضي أو عدّى.
 */
export function modelStatusRows(chain, stateRows, now = Date.now()) {
  const byModel = new Map((stateRows || []).filter((r) => !isInternalStateRow(r)).map((r) => [r.model, r]));
  return chain.map((model) => {
    const row = byModel.get(model);
    const until = row?.exhausted_until ? new Date(row.exhausted_until).getTime() : null;
    const blocked = until !== null && !Number.isNaN(until) && until > now;
    return {
      model,
      available: !blocked,
      until: blocked ? new Date(until).toISOString() : null,
      reason: blocked ? row.reason || null : null,
      reasonLabel: blocked ? REASON_LABEL[row.reason] || 'غير متاح' : null,
      detail: blocked ? row.detail || '' : '',
    };
  });
}

export const allUnavailable = (rows) => rows.length > 0 && rows.every((r) => !r.available);

/** أقرب وقت يرجع فيه أي موديل (ISO) أو null */
export function earliestReturn(rows) {
  const times = rows.filter((r) => !r.available && r.until).map((r) => new Date(r.until).getTime());
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

/** وقت بتوقيت القاهرة بالعربي: "الخميس 10:00 ص" أو مع التاريخ لو مش النهارده */
export function formatCairoTime(value, now = Date.now()) {
  if (!value) return '—';
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return '—';
  const opts = { timeZone: 'Africa/Cairo' };
  const day = (d) => new Date(d).toLocaleDateString('en-CA', opts);
  const time = t.toLocaleTimeString('ar-EG', { ...opts, hour: 'numeric', minute: '2-digit' });
  if (day(t) === day(now)) return `النهارده ${time}`;
  return `${t.toLocaleDateString('ar-EG', { ...opts, day: 'numeric', month: 'long' })} ${time}`;
}
