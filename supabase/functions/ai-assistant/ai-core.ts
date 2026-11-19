// ============================================
// طالب علم — ai-assistant: المنطق الصافي (من غير Deno ولا Supabase)
// ============================================
// كل القرارات اللي ممكن تتجرّب بدون شبكة هنا: تحديد اليوم بتوقيت القاهرة، تصنيف أخطاء
// Gemini، سلسلة الموديلات ووقت رجوع كل موديل، تنضيف الـ history، حالة الطالب (status).
// index.ts بيستخدم الملف ده بس ومبيعملش قرارات بنفسه. الاختبارات: tests/edge/ai_core.test.ts
// ============================================

export const CAIRO_TZ = 'Africa/Cairo';
export const PACIFIC_TZ = 'America/Los_Angeles'; // جوجل بتصفّر الحصص اليومية منتصف الليل بتوقيته

// ---------- اليوم والشهر بتوقيت القاهرة ----------

function partsIn(tz: string, d: Date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const o: Record<string, number> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') o[p.type] = Number(p.value);
  }
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** yyyy-MM-dd بتوقيت القاهرة (الطالب بيشوف يومه بيتجدد منتصف الليل عنده، مش ٢ الفجر) */
export function cairoDayKey(d: Date = new Date()): string {
  const p = partsIn(CAIRO_TZ, d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function cairoMonthKey(d: Date = new Date()): string {
  return cairoDayKey(d).slice(0, 7);
}

function dayKeyIn(tz: string, d: Date): string {
  const p = partsIn(tz, d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** أول لحظة بعد [d] اليوم فيها بيتغيّر في المنطقة الزمنية دي (يعني منتصف الليل الجاي).
 *  بنبحث بالتنصيف عن لحظة تغيّر اليوم بدل الحساب بالإزاحة، عشان ليلة تغيير التوقيت الصيفي
 *  (ساعة بتتقدّم أو بترجع) تطلع صح. */
export function nextMidnightIn(tz: string, d: Date = new Date()): Date {
  const start = dayKeyIn(tz, d);
  let lo = d.getTime();
  let hi = lo + 26 * 3600 * 1000; // اليوم بيتغيّر دايمًا خلال ٢٦ ساعة
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKeyIn(tz, new Date(mid)) === start) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

export const nextCairoMidnight = (d: Date = new Date()) => nextMidnightIn(CAIRO_TZ, d);
export const nextPacificMidnight = (d: Date = new Date()) => nextMidnightIn(PACIFIC_TZ, d);

// ---------- تصنيف أخطاء Gemini ----------

export type GeminiFailureKind =
  | 'quota_daily'   // الحصة اليومية خلصت
  | 'quota_minute'  // حد الدقيقة (مؤقت)
  | 'overloaded'    // الموديل تحت ضغط (٥٠٣ وأخواتها)
  | 'timeout'       // الطلب اتأخر
  | 'bad_model'     // اسم موديل غلط أو اتشال
  | 'auth'          // المفتاح مش شغال — كل الموديلات هتفشل
  | 'bad_request'   // الطلب نفسه مرفوض (٤٠٠)
  | 'other';

export interface GeminiFailure {
  kind: GeminiFailureKind;
  retryAfterSec?: number;
  detail: string;
}

/** "65522s" أو "3.5s" */
function parseDelay(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const m = v.match(/^([\d.]+)s$/);
  return m ? Number(m[1]) : undefined;
}

/** "Please retry in 18h16m32.5s" */
function parseRetryInText(msg: string): number | undefined {
  const m = msg.match(/retry in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export function classifyGeminiFailure(status: number, bodyText: string): GeminiFailure {
  const detail = `${status} ${bodyText}`.slice(0, 400);
  if (status === 0) return { kind: bodyText === 'timeout' ? 'timeout' : 'other', detail };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let err: any = null;
  try { err = JSON.parse(bodyText)?.error ?? null; } catch { /* نص مش JSON */ }
  const message: string = typeof err?.message === 'string' ? err.message : bodyText;
  const apiStatus: string = typeof err?.status === 'string' ? err.status : '';

  let retryAfterSec: number | undefined;
  let quotaIds = '';
  for (const d of Array.isArray(err?.details) ? err.details : []) {
    const type = String(d?.['@type'] ?? '');
    if (type.endsWith('RetryInfo')) retryAfterSec = parseDelay(d?.retryDelay);
    if (type.endsWith('QuotaFailure')) {
      for (const v of Array.isArray(d?.violations) ? d.violations : []) quotaIds += ` ${v?.quotaId ?? ''} ${v?.quotaMetric ?? ''}`;
    }
  }
  retryAfterSec ??= parseRetryInText(message);

  if (status === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
    const hay = `${quotaIds} ${message}`.toLowerCase();
    if (hay.includes('perday') || hay.includes('per day') || hay.includes('requests_per_day')) {
      return { kind: 'quota_daily', retryAfterSec, detail };
    }
    // مفيش دليل إنها يومية: لو الانتظار المقترح طويل (أكتر من ساعة) نعتبرها يومية
    if ((retryAfterSec ?? 0) > 3600) return { kind: 'quota_daily', retryAfterSec, detail };
    return { kind: 'quota_minute', retryAfterSec, detail };
  }
  if (status === 404) return { kind: 'bad_model', detail };
  if (status === 401 || status === 403 || /api key/i.test(message)) return { kind: 'auth', detail };
  if (status >= 500 || apiStatus === 'UNAVAILABLE') return { kind: 'overloaded', retryAfterSec, detail };
  if (status === 400) return { kind: 'bad_request', detail };
  return { kind: 'other', detail };
}

export const isQuotaKind = (k: GeminiFailureKind) => k === 'quota_daily' || k === 'quota_minute';

/** لحد إمتى نتخطّى الموديل ده بعد الفشل ده */
export function cooldownUntil(f: GeminiFailure, now: Date = new Date()): Date | null {
  const ms = (sec: number) => new Date(now.getTime() + sec * 1000);
  switch (f.kind) {
    case 'quota_daily':
      // الأدق: الوقت اللي جوجل قالته. غير كده: منتصف الليل بتوقيتها
      return f.retryAfterSec && f.retryAfterSec >= 60 ? ms(f.retryAfterSec + 5) : nextPacificMidnight(now);
    case 'quota_minute':
      return ms(Math.min(Math.max(f.retryAfterSec ?? 60, 30), 300));
    case 'overloaded':
    case 'timeout':
      return ms(30);
    case 'bad_model':
      return ms(30 * 60);
    default:
      return null; // auth / bad_request / other: مفيش تخطّي، بنجرّب الموديل التالي بس للطلب ده
  }
}

// ---------- سلسلة الموديلات ----------

const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,60}$/i;

/** أسماء موديلات صالحة بس، بنفس ترتيبها ومن غير تكرار */
export function sanitizeModelNames(names: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(names)) return out;
  for (const v of names) {
    if (typeof v !== 'string') continue;
    const name = v.trim().replace(/^models\//, '');
    if (MODEL_NAME_RE.test(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** الأساسي أولًا ثم البدائل بترتيبها، من غير تكرار ومن غير أسماء مش منطقية */
export function buildModelChain(primary: unknown, fallbacks: unknown, defaultModel = 'gemini-2.5-flash-lite', max = 5): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v !== 'string') return;
    const name = v.trim().replace(/^models\//, '');
    if (MODEL_NAME_RE.test(name) && !out.includes(name)) out.push(name);
  };
  add(primary || defaultModel);
  if (Array.isArray(fallbacks)) fallbacks.forEach(add);
  return out.slice(0, max);
}

/** الموديلات المتاحة دلوقتي بترتيب الأولوية + أقرب وقت رجوع لو مفيش ولا واحد */
export function availableModels(chain: string[], cooldowns: Map<string, { until: Date; reason: string }>, now: Date = new Date()) {
  const available: string[] = [];
  let earliest: Date | null = null;
  let allQuota = true;
  for (const m of chain) {
    const c = cooldowns.get(m);
    if (!c || c.until.getTime() <= now.getTime()) {
      available.push(m);
      continue;
    }
    if (!earliest || c.until < earliest) earliest = c.until;
    if (c.reason !== 'quota_daily' && c.reason !== 'quota_minute') allQuota = false;
  }
  return { available, earliestRetry: earliest, allQuota: chain.length > 0 && allQuota };
}

// ---------- الـ history (ذاكرة المحادثة) ----------

export interface HistoryEntry { role: 'user' | 'model'; text: string }

const MAX_HISTORY_ENTRIES = 8;
const MAX_ENTRY_CHARS = 1500;
const MAX_HISTORY_CHARS = 6000;

/** بيقبل history جاي من التطبيق (ممكن يكون فيه أي حاجة) ويرجّعه نضيف وآمن لـ Gemini:
 *  أدوار مقبولة بس، نصوص مقصوصة، متناوب، بيبدأ بسؤال طالب وبينتهي برد (عشان السؤال الجديد بعده). */
export function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  let items: HistoryEntry[] = [];
  for (const e of raw.slice(-MAX_HISTORY_ENTRIES)) {
    const role = e?.role === 'user' ? 'user' : (e?.role === 'model' || e?.role === 'bot') ? 'model' : null;
    const text = typeof e?.text === 'string' ? e.text.trim().slice(0, MAX_ENTRY_CHARS) : '';
    if (!role || !text) continue;
    items.push({ role, text });
  }
  // تناوب: لو دورين ورا بعض من نفس النوع نحتفظ بالأحدث
  const alternated: HistoryEntry[] = [];
  for (const it of items) {
    if (alternated.length && alternated[alternated.length - 1].role === it.role) alternated.pop();
    alternated.push(it);
  }
  items = alternated;
  while (items.length && items[0].role !== 'user') items.shift();
  while (items.length && items[items.length - 1].role !== 'model') items.pop();
  // حد إجمالي للحجم: نشيل الأقدم
  let total = items.reduce((n, e) => n + e.text.length, 0);
  while (items.length > 0 && total > MAX_HISTORY_CHARS) {
    total -= items.shift()!.text.length;
    while (items.length && items[0].role !== 'user') total -= items.shift()!.text.length;
  }
  return items;
}

export function buildContents(history: HistoryEntry[], message: string) {
  return [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
}

// ---------- الخطط والاشتراكات ----------

export interface PlanRow { id: number; name: string; daily_limit: number; models?: string[] | null }
export interface SubscriptionRow { plan_id: number; status: string; starts_at: string; ends_at: string | null }

export interface ActivePlan {
  id: number;
  name: string;
  dailyLimit: number;
  models: string[];
  endsAt: Date | null;
  daysLeft: number | null; // null = من غير نهاية
}

const DAY_MS = 24 * 3600 * 1000;

/** الخطة الفعّالة دلوقتي للطالب. لو عنده أكتر من اشتراك فعّال: صاحبة أكبر حد يومي (ولو
 *  اتساووا: اللي من غير نهاية، وبعدها الأبعد نهاية). الاشتراك الملغي أو المنتهي أو اللي لسه مبدأش مبيتحسبش. */
export function pickActivePlan(subs: SubscriptionRow[], plans: PlanRow[], now: Date = new Date()): ActivePlan | null {
  let best: ActivePlan | null = null;
  for (const sub of subs ?? []) {
    if (sub.status !== 'active') continue;
    const start = new Date(sub.starts_at).getTime();
    const end = sub.ends_at ? new Date(sub.ends_at).getTime() : null;
    if (!(start <= now.getTime()) || (end !== null && end <= now.getTime())) continue;
    const plan = (plans ?? []).find((p) => p.id === sub.plan_id);
    if (!plan || !(plan.daily_limit > 0)) continue;
    const candidate: ActivePlan = {
      id: plan.id,
      name: plan.name,
      dailyLimit: plan.daily_limit,
      models: sanitizeModelNames(plan.models),
      endsAt: end === null ? null : new Date(end),
      daysLeft: end === null ? null : Math.max(1, Math.ceil((end - now.getTime()) / DAY_MS)),
    };
    const better = !best
      || candidate.dailyLimit > best.dailyLimit
      || (candidate.dailyLimit === best.dailyLimit && (candidate.endsAt === null ? Number.POSITIVE_INFINITY : candidate.endsAt.getTime())
        > (best.endsAt === null ? Number.POSITIVE_INFINITY : best.endsAt.getTime()));
    if (better) best = candidate;
  }
  return best;
}

/** الحد اليومي: لو فيه خطة = الأكبر بين حدها والتخصيص الفردي (عشان تخصيص قديم صغير ميقيّدش حد دافع).
 *  من غير خطة = التخصيص الفردي لو موجود، وإلا الافتراضي. */
export function effectiveDailyLimit(o: { override: number | null | undefined; planLimit: number | null; defaultLimit: number }): number {
  if (o.planLimit !== null && o.planLimit !== undefined) return Math.max(o.planLimit, o.override ?? 0);
  return o.override ?? o.defaultLimit;
}

/** موديلات الخطة الأول، وبعدها السلسلة العامة كاحتياطي (المشترك عمره ما يبقى أسوأ حالًا من المجاني) */
export function mergeModelChains(planModels: string[], globalChain: string[], max = 6): string[] {
  const out: string[] = [];
  for (const m of [...planModels, ...globalChain]) if (!out.includes(m)) out.push(m);
  return out.slice(0, max);
}

/** عدد التوكنز من رد Gemini (usageMetadata). توكنز التفكير بتتحسب إخراج (هي كده في الفاتورة). */
export function extractUsage(data: unknown): { input: number; output: number } {
  // deno-lint-ignore no-explicit-any
  const u = (data as any)?.usageMetadata;
  const n = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.floor(v) : 0);
  return { input: n(u?.promptTokenCount), output: n(u?.candidatesTokenCount) + n(u?.thoughtsTokenCount) };
}

// ---------- حالة الطالب ورسائل الحظر ----------

export type AiState = 'ok' | 'feature_off' | 'not_enabled' | 'daily_limit' | 'monthly_limit' | 'models_exhausted';

export const BLOCK_REASONS: Record<string, string> = {
  feature_off: 'بو متوقف مؤقتًا. هيرجع قريب.',
  not_enabled: 'بو مش مفعّل على حسابك. تواصل مع الأدمن لتفعيله.',
  daily_limit: 'خلّصت رسايلك لليوم. بتتجدد منتصف الليل.',
  monthly_limit: 'بو وصل لأقصى استخدام الشهر ده لكل الطلاب. هيرجع الشهر الجاي.',
  models_exhausted: 'رصيد بو خلص دلوقتي وهيرجع قريب. جرّب تاني بعدين.',
  too_fast: 'استنى ثواني وابعت تاني',
  too_many: 'بعتّ رسايل كتير أوي في وقت قصير، استنى دقيقة وجرّب تاني',
};

/** رد "ممنوع" بكود ثابت. `reason` للتوافق مع نسخ التطبيق القديمة اللي بتعرضه كنص. */
export function blockedBody(code: string, extra: Record<string, unknown> = {}): { blocked: true; code: string; reason: string; [k: string]: unknown } {
  return { blocked: true, code, reason: BLOCK_REASONS[code] ?? BLOCK_REASONS.feature_off, ...extra };
}

export interface StatusInput {
  globalEnabled: boolean;
  userEnabled: boolean;
  dailyLimit: number;
  usedToday: number;
  monthlyLimit: number;
  monthlyCount: number;
  modelsAvailable: boolean;
  modelsRetryAt: Date | null;
  now: Date;
  plan?: ActivePlan | null;
}

export interface AiStatus {
  state: AiState;
  available: boolean;
  daily_limit: number;
  used_today: number;
  remaining_today: number;
  resets_at: string;
  retry_at: string | null;
  plan: { name: string; daily_limit: number; ends_at: string | null; days_left: number | null } | null;
}

export function computeStatus(i: StatusInput): AiStatus {
  const remaining = Math.max(0, i.dailyLimit - i.usedToday);
  let state: AiState = 'ok';
  if (!i.globalEnabled) state = 'feature_off';
  else if (!i.userEnabled) state = 'not_enabled';
  else if (remaining <= 0) state = 'daily_limit';
  // المشتركين مبيتأثروش بالسقف الشهري العام (دخلهم هو اللي بيمول الاستهلاك)
  else if (!i.plan && i.monthlyLimit > 0 && i.monthlyCount >= i.monthlyLimit) state = 'monthly_limit';
  else if (!i.modelsAvailable) state = 'models_exhausted';
  return {
    state,
    available: state === 'ok',
    daily_limit: i.dailyLimit,
    used_today: Math.min(i.usedToday, i.dailyLimit),
    remaining_today: remaining,
    resets_at: nextCairoMidnight(i.now).toISOString(),
    retry_at: state === 'models_exhausted' && i.modelsRetryAt ? i.modelsRetryAt.toISOString() : null,
    plan: i.plan
      ? { name: i.plan.name, daily_limit: i.plan.dailyLimit, ends_at: i.plan.endsAt ? i.plan.endsAt.toISOString() : null, days_left: i.plan.daysLeft }
      : null,
  };
}
