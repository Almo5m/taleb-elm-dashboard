import { UNLOCKABLE_FEATURES, UNLOCKABLE_KINDS } from '../constants/unlockables';

// حدود الحقول هنا (مش في constants/unlockables.js) عشان استبدال الكتالوج بملف جديد ميمسحهاش
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 160;
export const MAX_RULES = 200;

// ---------- شروط الفتح (لازم الـ ids تتطابق حرفيًا مع التطبيق) ----------
const MAX_COUNT_VALUE = 1_000_000; // سقف عملي عشان غلطة كتابة (700000 يوم) متخلّيش الميزة مستحيلة
const fmt = (n) => n.toLocaleString('ar-EG');

// 1 → المفرد، 2 → المثنى، 3-10 → الجمع، 11+ → المفرد (قواعد العدد في العربي)
function countPhrase(n, forms) {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  return `${fmt(n)} ${n >= 3 && n <= 10 ? forms.few : forms.many}`;
}
const forms = (one, two, few, many = one) => ({ one, two, few, many });

const DAYS = forms('يوم', 'يومين', 'أيام');
const HOURS = forms('ساعة', 'ساعتين', 'ساعات');
const SESSIONS = forms('جلسة', 'جلستين', 'جلسات');
const TASKS = forms('مهمة', 'مهمتين', 'مهام');
const LECTURES = forms('محاضرة', 'محاضرتين', 'محاضرات');
const HOMEWORK = forms('واجب', 'واجبين', 'واجبات');
const EXAMS = forms('امتحان', 'امتحانين', 'امتحانات');

// describe = الصيغة المختصرة في الجدول، clause = اللي بتظهر للطالب بعد "اتفتح لما"
export const CONDITION_TYPES = [
  { id: 'streak_days', label: 'أطول ستريك (أيام)', max: MAX_COUNT_VALUE,
    describe: (n) => `ستريك ${countPhrase(n, DAYS)}`, clause: (n) => `توصل لستريك ${countPhrase(n, DAYS)}` },
  { id: 'study_hours_total', label: 'إجمالي ساعات المذاكرة', max: MAX_COUNT_VALUE,
    describe: (n) => `مذاكرة ${countPhrase(n, HOURS)}`, clause: (n) => `تذاكر ${countPhrase(n, HOURS)}` },
  { id: 'study_sessions_total', label: 'جلسات المذاكرة المكتملة', max: MAX_COUNT_VALUE,
    describe: (n) => `إكمال ${countPhrase(n, SESSIONS)} مذاكرة`, clause: (n) => `تكمّل ${countPhrase(n, SESSIONS)} مذاكرة` },
  { id: 'tasks_done_total', label: 'المهام المنجزة', max: MAX_COUNT_VALUE,
    describe: (n) => `إنجاز ${countPhrase(n, TASKS)}`, clause: (n) => `تنجز ${countPhrase(n, TASKS)}` },
  { id: 'lectures_watched_total', label: 'المحاضرات المكتملة', max: MAX_COUNT_VALUE,
    describe: (n) => `إكمال ${countPhrase(n, LECTURES)}`, clause: (n) => `تكمّل ${countPhrase(n, LECTURES)}` },
  { id: 'homework_graded_total', label: 'واجبات اتسجّلت درجتها', max: MAX_COUNT_VALUE,
    describe: (n) => `تسجيل درجة ${countPhrase(n, HOMEWORK)}`, clause: (n) => `تسجّل درجة ${countPhrase(n, HOMEWORK)}` },
  { id: 'exams_graded_total', label: 'امتحانات اتسجّلت درجتها', max: MAX_COUNT_VALUE,
    describe: (n) => `تسجيل درجة ${countPhrase(n, EXAMS)}`, clause: (n) => `تسجّل درجة ${countPhrase(n, EXAMS)}` },
  { id: 'average_grade_min', label: 'متوسط الدرجات (٪) لا يقل عن', max: 100,
    describe: (n) => `متوسط درجات ${fmt(n)}٪ أو أكتر (بعد ٣ درجات على الأقل)`,
    clause: (n) => `يبقى متوسط درجاتك ${fmt(n)}٪ أو أكتر (بعد ٣ درجات على الأقل)` },
];

const CONDITION_MAP = new Map(CONDITION_TYPES.map((c) => [c.id, c]));
const FEATURE_MAP = new Map(UNLOCKABLE_FEATURES.map((f) => [f.feature_id, f]));
// الأنواع المتوصلة في التطبيق بس — نوع تاني (زي theme) معناه قاعدة غير صالحة لحد ما يتضاف في الكتالوج
const KIND_IDS = new Set(Object.keys(UNLOCKABLE_KINDS));
export const KIND_OPTIONS = Object.entries(UNLOCKABLE_KINDS).map(([id, label]) => ({ id, label }));

export const getConditionType = (id) => CONDITION_MAP.get(id);
export const getFeature = (id) => FEATURE_MAP.get(id);
export const getKindLabel = (id) => (KIND_IDS.has(id) ? UNLOCKABLE_KINDS[id] : id);

const isValidValue = (type, value) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= (CONDITION_MAP.get(type)?.max ?? 0);

export function describeCondition(condition) {
  const type = CONDITION_MAP.get(condition?.type);
  return type && isValidValue(condition.type, condition.value) ? type.describe(condition.value) : '—';
}

/** "🔒 <title> — اتفتح لما <الشرط>" زي ما الطالب هيشوفها، أو null لو الشرط لسه ناقص */
export function previewText({ title, condition }) {
  const type = CONDITION_MAP.get(condition?.type);
  if (!type || !isValidValue(condition.type, condition.value)) return null;
  return `🔒 ${(title || '').trim() || '…'} — اتفتح لما ${type.clause(condition.value)}`;
}

// ---------- التحقق ----------
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** رسايل الأخطاء لعنصر واحد (فاضية = سليم). مبتشوفش التكرار، ده شغل validateUnlockables */
export function validateItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ['العنصر شكله غلط'];
  const errors = [];

  const feature = typeof item.feature_id === 'string' ? FEATURE_MAP.get(item.feature_id) : undefined;
  if (!feature) errors.push('الميزة مش موجودة في القايمة الجاهزة');

  if (!KIND_IDS.has(item.kind)) errors.push('نوع الميزة غير صالح');
  else if (feature && feature.kind !== item.kind) errors.push('نوع الميزة مش مطابق للقايمة');

  if (typeof item.title !== 'string' || !item.title.trim()) errors.push('العنوان فاضي');
  else {
    if (item.title.trim().length > TITLE_MAX) errors.push(`العنوان أطول من ${TITLE_MAX} حرف`);
    if (CONTROL_CHARS.test(item.title)) errors.push('العنوان فيه رموز غير مسموحة (سطر جديد أو رموز تحكم)');
  }

  if (item.description !== undefined && item.description !== null) {
    if (typeof item.description !== 'string') errors.push('الوصف لازم يكون نص');
    else {
      if (item.description.trim().length > DESCRIPTION_MAX) errors.push(`الوصف أطول من ${DESCRIPTION_MAX} حرف`);
      if (CONTROL_CHARS.test(item.description)) errors.push('الوصف فيه رموز غير مسموحة (سطر جديد أو رموز تحكم)');
    }
  }

  const condition = item.condition;
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    errors.push('الشرط ناقص');
  } else if (!CONDITION_MAP.has(condition.type)) {
    errors.push('نوع الشرط غير صالح');
  } else if (!isValidValue(condition.type, condition.value)) {
    const max = CONDITION_MAP.get(condition.type).max;
    errors.push(condition.type === 'average_grade_min'
      ? 'المتوسط لازم يكون رقم صحيح من 1 لـ 100'
      : `القيمة لازم تكون رقم صحيح موجب (لحد ${fmt(max)})`);
  }

  if (typeof item.enabled !== 'boolean') errors.push('حالة التفعيل لازم تكون مفعّلة أو معطّلة');
  return errors;
}

/** الشكل اللي بيتكتب فعلًا (حقول معروفة بس، نصوص متقلّمة، الوصف الفاضي "") */
export function normalizeItem(item) {
  return {
    feature_id: item.feature_id,
    kind: item.kind,
    title: item.title.trim(),
    description: (item.description ?? '').trim(),
    condition: { type: item.condition.type, value: item.condition.value },
    enabled: item.enabled,
  };
}

/**
 * يتحقق من المصفوفة كلها (كله أو لا شيء).
 * { ok, errors: [{ index, featureId, messages }], items } — items بتتملي بس لو ok.
 */
export function validateUnlockables(list) {
  if (!Array.isArray(list)) {
    return { ok: false, errors: [{ index: -1, featureId: null, messages: ['القيمة المحفوظة مش مصفوفة'] }], items: [] };
  }

  const errors = [];
  if (list.length > MAX_RULES) {
    errors.push({ index: -1, featureId: null, messages: [`عدد القواعد أكتر من ${MAX_RULES}`] });
  }

  const firstSeen = new Map();
  list.forEach((item, index) => {
    const messages = validateItem(item);
    const id = typeof item?.feature_id === 'string' ? item.feature_id : null;
    if (id) {
      if (firstSeen.has(id)) messages.push(`الميزة دي ليها قاعدة تانية (رقم ${firstSeen.get(id) + 1}) — قاعدة واحدة لكل ميزة`);
      else firstSeen.set(id, index);
    }
    if (messages.length) errors.push({ index, featureId: id, messages });
  });

  if (errors.length) return { ok: false, errors, items: [] };
  return { ok: true, errors: [], items: list.map(normalizeItem) };
}

// ---------- مقارنة (لسجل النشاط) ----------
const FIELDS = [
  ['title', (i) => i?.title],
  ['description', (i) => i?.description ?? ''],
  ['condition_type', (i) => i?.condition?.type],
  ['condition_value', (i) => i?.condition?.value],
  ['enabled', (i) => i?.enabled],
];

export function diffUnlockables(before, after) {
  const beforeMap = new Map(before.map((i) => [i?.feature_id, i]));
  const afterMap = new Map(after.map((i) => [i?.feature_id, i]));

  const added = after.filter((i) => !beforeMap.has(i.feature_id)).map((i) => i.feature_id);
  const removed = before.filter((i) => !afterMap.has(i?.feature_id)).map((i) => i?.feature_id);

  const changed = [];
  for (const [id, afterItem] of afterMap) {
    const beforeItem = beforeMap.get(id);
    if (!beforeItem) continue;
    const changes = {};
    for (const [name, get] of FIELDS) {
      if (get(beforeItem) !== get(afterItem)) changes[name] = { from: get(beforeItem) ?? null, to: get(afterItem) ?? null };
    }
    if (Object.keys(changes).length) changed.push({ feature_id: id, changes });
  }

  const common = (list, other) => list.filter((i) => other.has(i?.feature_id)).map((i) => i?.feature_id).join('|');
  const reordered = common(before, afterMap) !== common(after, beforeMap);

  return { added, removed, changed, reordered };
}

export const hasChanges = (diff) =>
  diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0 || diff.reordered;

/** تمثيل ثابت (مفاتيح مرتّبة) للمقارنة بين قيمتين JSON من غير ما ترتيب المفاتيح يفرق */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
