// منطق وحدات المنهج وأترامه (نقي، من غير React ولا Supabase) عشان يتختبر لوحده.
// الداتا: catalog_units (الوحدة تابعة لمادة وممكن لترم)، و catalog_lessons.unit_id (الدرس تابع لوحدة أو من غير).
// الرقم مش حقل: السيرفر بيحسبه من الترتيب جوه كل ترم، واللوحة بتحسب نفس المعاينة هنا.
import { normalizeTitle, parseBulkLines } from './catalog.js';

export const UNIT_TITLE_MAX = 200;
export const UNIT_LABEL_MAX = 20;
export const DEFAULT_UNIT_LABEL = 'وحدة';
export const LABEL_SUGGESTIONS = ['وحدة', 'فصل', 'باب', 'Unit'];

// ترتيب عرض الترمات: السنة كاملة (من غير ترم) الأول، بعدين الأول، بعدين التاني (زي ترتيب التطبيق)
export const TERM_TABS = [
  { key: 'year', term: null, label: 'السنة كاملة' },
  { key: '1', term: 1, label: 'الترم الأول' },
  { key: '2', term: 2, label: 'الترم الثاني' },
];

export const termKey = (term) => (term === 1 || term === 2 ? String(term) : 'year');
export const termFromKey = (key) => (key === '1' ? 1 : key === '2' ? 2 : null);
// قيمة <select> لترم الوحدة ('' = السنة كاملة) وتحويلها لقيمة تتكتب
export const termSelectValue = (term) => (term === 1 || term === 2 ? String(term) : '');
export const termFromSelect = (value) => (value === '1' ? 1 : value === '2' ? 2 : null);

// ---------- العنوان زي ما هيظهر للطالب ----------

const FEMININE = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة',
  'الحادية عشرة', 'الثانية عشرة', 'الثالثة عشرة', 'الرابعة عشرة', 'الخامسة عشرة', 'السادسة عشرة', 'السابعة عشرة', 'الثامنة عشرة', 'التاسعة عشرة', 'العشرون'];
const MASCULINE = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
  'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون'];

const toArabicDigits = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

/** نوع المسمى: english (يبدأ بحرف لاتيني) | feminine (بينتهي بتاء مربوطة) | masculine */
export function labelKind(label) {
  const l = String(label ?? '').trim();
  if (/^[A-Za-z]/.test(l)) return 'english';
  return l.endsWith('ة') ? 'feminine' : 'masculine';
}

/** الترتيب بالكلام: ١–٢٠ بالمؤنث أو المذكر، وبعدها null (بنعرض الرقم بس) */
export function ordinalWord(n, feminine) {
  if (!Number.isInteger(n) || n < 1) return null;
  return n <= 20 ? (feminine ? FEMININE : MASCULINE)[n - 1] : null;
}

/**
 * عنوان الوحدة زي ما هيظهر في التطبيق: «{المسمى} {الترتيب}: {الاسم}».
 * العربي بياخد "ال" (الباب الأول، الوحدة الثانية)، والإنجليزي الرقم بس (Unit 2: Family).
 * number = null يعني مفيش رقم (وحدة مخفية): بنعرض الاسم بس.
 * ⚠️ شكل "ال" والأرقام العربي بعد ٢٠ مستنتج من أمثلة الوصف، راجعه على التطبيق.
 */
export function formatUnitTitle(label, number, name) {
  const title = String(name ?? '').trim();
  if (number === null || number === undefined) return title;
  const l = String(label ?? '').trim() || DEFAULT_UNIT_LABEL;
  const kind = labelKind(l);
  if (kind === 'english') return `${l} ${number}: ${title}`;
  const words = l.split(/\s+/);
  if (!words[0].startsWith('ال')) words[0] = `ال${words[0]}`;
  const word = ordinalWord(number, kind === 'feminine');
  return `${words.join(' ')} ${word ?? toArabicDigits(number)}: ${title}`;
}

// ---------- الترقيم والتجميع ----------

const bySort = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0);

/** وحدات ترم معيّن مرتبة */
export const unitsOfTerm = (units, term) => units.filter((u) => (u.term ?? null) === term).sort(bySort);

/**
 * رقم كل وحدة جوه ترمها: بيبدأ من ١ في كل ترم، والوحدات المخفية بتتخطى (مش ظاهرة للطالب، فمالهاش رقم).
 * ⚠️ افتراض: السيرفر بيرقّم الظاهر بس. لو بيرقّم الكل، غيّر الشرط هنا.
 */
export function unitNumbers(units) {
  const numbers = {};
  for (const tab of TERM_TABS) {
    let n = 0;
    for (const u of unitsOfTerm(units, tab.term)) numbers[u.id] = u.is_active ? (n += 1) : null;
  }
  return numbers;
}

/** تحريك وحدة جوه ترمها بس (بيتخطى وحدات الأترام التانية). بيرجّع قايمة جديدة أو نفسها لو مفيش حركة */
export function moveUnit(units, id, dir) {
  const index = units.findIndex((u) => u.id === id);
  if (index < 0) return units;
  const term = units[index].term ?? null;
  let to = index + dir;
  while (to >= 0 && to < units.length && (units[to].term ?? null) !== term) to += dir;
  if (to < 0 || to >= units.length) return units;
  const copy = [...units];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  // sort_order بيتجدّد مع الموضع، وإلا العرض (المرتّب بـ sort_order) مايتحركش ومعاينة الأرقام مبتتغيّرش قبل الحفظ
  return copy.map((u, i) => ({ ...u, sort_order: i + 1 }));
}

/** كتابة الترتيب: كل وحدات المادة بأرقام متتالية من ١ (upsert بالـ id) */
export function reorderUnitRows(units) {
  return units.map((u, i) => ({ id: u.id, subject_id: u.subject_id, title: u.title, term: u.term ?? null, is_active: u.is_active, sort_order: i + 1 }));
}

export const unitOrderChanged = (saved, current) => saved.length !== current.length || saved.some((u, i) => u.id !== current[i].id);

export const nextUnitOrder = (units) => units.reduce((m, u) => Math.max(m, Number(u.sort_order) || 0), 0) + 1;

// ---------- الفحص ----------

// \b مبتشتغلش مع الحروف العربية، فبنستخدم lookahead يتأكد إن الكلمة خلصت (مش بداية كلمة أطول زي "الأولياء")
const NUMBERED_TITLE = /^(?:ال)?(?:وحدة|باب|فصل|unit|chapter)\s*(?:\d+|[٠-٩]+|(?:الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)[ةىي]?|الحادي عشر|الثاني عشر)(?![\u0621-\u064A\w])/i;

export function validateUnitTitle(title) {
  const t = String(title ?? '').trim();
  if (!t) return 'اكتب اسم الوحدة';
  if (t.length > UNIT_TITLE_MAX) return `الاسم أطول من ${UNIT_TITLE_MAX} حرف`;
  // الرقم بيتحسب لوحده: لو الأدمن كتب "الباب الأول: ..." العنوان هيطلع مكرر
  if (NUMBERED_TITLE.test(t)) {
    return 'اكتب اسم الوحدة بس من غير رقم ولا كلمة "الباب" أو "الوحدة". الرقم بيتحسب تلقائي';
  }
  return null;
}

export function validateUnitLabel(label) {
  const l = String(label ?? '').trim();
  if (!l) return 'اكتب مسمى الوحدات (مثلًا: وحدة، باب، فصل)';
  if (l.length > UNIT_LABEL_MAX) return `المسمى أطول من ${UNIT_LABEL_MAX} حرف`;
  return null;
}

/** وحدة بنفس الاسم في نفس المادة والترم؟ (قص المسافات وتجاهل حالة الأحرف) */
export function findDuplicateUnit(units, title, term, ignoreId = null) {
  const key = normalizeTitle(title);
  return units.find((u) => u.id !== ignoreId && (u.term ?? null) === (term ?? null) && normalizeTitle(u.title) === key) || null;
}

/** دروس وحدة (أو الدروس من غير وحدة لو unitId = null) مرتبة */
export const lessonsOfUnit = (lessons, unitId) => lessons.filter((l) => (l.unit_id ?? null) === (unitId ?? null)).sort(bySort);

/** درس بنفس العنوان جوه نفس الوحدة؟ (الدروس من غير وحدة: جوه المادة) */
export function findDuplicateLesson(lessons, unitId, title, ignoreId = null) {
  const key = normalizeTitle(title);
  return lessonsOfUnit(lessons, unitId).find((l) => l.id !== ignoreId && normalizeTitle(l.title) === key) || null;
}

/** الإضافة المجمّعة جوه وحدة: بتتخطى المكرر جوه الوحدة بس */
export const planBulkInUnit = (text, lessons, unitId) => parseBulkLines(text, lessonsOfUnit(lessons, unitId).map((l) => l.title));

export const buildUnitLessonRows = (subjectId, unitId, titles, startOrder) =>
  titles.map((title, i) => ({ subject_id: subjectId, unit_id: unitId ?? null, title, sort_order: startOrder + i, is_active: true }));

export const nextLessonOrder = (lessons, unitId) => lessonsOfUnit(lessons, unitId).reduce((m, l) => Math.max(m, Number(l.sort_order) || 0), 0) + 1;

/** عدد دروس كل وحدة: { [unit_id]: { visible, hidden } } والمفتاح 'none' للدروس من غير وحدة */
export function lessonCountsByUnit(lessons) {
  const out = {};
  for (const l of lessons) {
    const e = (out[l.unit_id ?? 'none'] ||= { visible: 0, hidden: 0 });
    if (l.is_active) e.visible += 1; else e.hidden += 1;
  }
  return out;
}

// ---------- ترتيب الدروس جوه وحدتها ----------

/** تحريك درس جوه وحدته بس. lessons = كل دروس المادة. بيرجّع القايمة الكاملة بعد الحركة */
export function moveLesson(lessons, id, dir) {
  const target = lessons.find((l) => l.id === id);
  if (!target) return lessons;
  const group = lessonsOfUnit(lessons, target.unit_id);
  const gi = group.findIndex((l) => l.id === id);
  const gj = gi + dir;
  if (gj < 0 || gj >= group.length) return lessons;
  const reordered = [...group];
  [reordered[gi], reordered[gj]] = [reordered[gj], reordered[gi]];
  const order = new Map(reordered.map((l, i) => [l.id, i + 1]));
  return lessons.map((l) => (order.has(l.id) ? { ...l, sort_order: order.get(l.id) } : l));
}

/** صفوف الحفظ لدروس مجموعة واحدة (وحدة أو من غير وحدة)، بأرقام متتالية من ١ */
export function reorderLessonRows(lessons, unitId) {
  return lessonsOfUnit(lessons, unitId).map((l, i) => ({ id: l.id, subject_id: l.subject_id, unit_id: l.unit_id ?? null, title: l.title, is_active: l.is_active, sort_order: i + 1 }));
}

export const lessonOrderChanged = (saved, current, unitId) => {
  const a = lessonsOfUnit(saved, unitId).map((l) => l.id).join();
  const b = lessonsOfUnit(current, unitId).map((l) => l.id).join();
  return a !== b;
};

// ---------- نقل الدروس بين الوحدات ----------

/**
 * خطة نقل دروس محددة لوحدة: بتتخطى اللي عنوانه موجود في الوحدة الهدف، وباقي الدروس بتتضاف بعد آخر ترتيب فيها.
 * الصفوف جاهزة لـ upsert بالـ id. targetUnit لازم من نفس مادة الدروس (السيرفر بيرفض غير كده).
 */
export function planMoveLessons(allLessons, ids, targetUnit) {
  const picked = new Set(ids);
  const moving = allLessons.filter((l) => picked.has(l.id)).sort(bySort);
  const seen = new Set(lessonsOfUnit(allLessons, targetUnit.id).map((l) => normalizeTitle(l.title)));
  let order = nextLessonOrder(allLessons, targetUnit.id);
  const rows = [];
  const skipped = [];
  for (const l of moving) {
    if (l.subject_id !== targetUnit.subject_id) { skipped.push({ title: l.title, reason: 'subject' }); continue; }
    if ((l.unit_id ?? null) === targetUnit.id) { skipped.push({ title: l.title, reason: 'same' }); continue; }
    const key = normalizeTitle(l.title);
    if (seen.has(key)) { skipped.push({ title: l.title, reason: 'duplicate' }); continue; }
    seen.add(key);
    rows.push({ id: l.id, subject_id: l.subject_id, unit_id: targetUnit.id, title: l.title, is_active: l.is_active, sort_order: order });
    order += 1;
  }
  return { rows, moved: rows.length, skipped };
}

// ---------- نسخ المنهج (وحدات بدروسها) لمادة تانية ----------

/**
 * خطة نسخ: الوحدات الظاهرة بدروسها الظاهرة (بنفس الترتيب والترم) + الدروس الظاهرة من غير وحدة.
 * - وحدة بنفس الاسم والترم موجودة في الهدف: بنضيف لها الدروس الناقصة بس (تخطي المكرر جوه الوحدة).
 * - وحدة جديدة: بتتضاف بعد آخر ترتيب في الهدف مع دروسها.
 */
export function planCurriculumCopy({ sourceUnits, sourceLessons, targetUnits, targetLessons }) {
  const activeLessons = (unitId) => lessonsOfUnit(sourceLessons, unitId).filter((l) => l.is_active);
  const createUnits = [];
  const mergeUnits = [];
  let skippedLessons = 0;
  let order = nextUnitOrder(targetUnits);

  for (const u of [...sourceUnits].filter((x) => x.is_active).sort(bySort)) {
    const titles = activeLessons(u.id).map((l) => l.title);
    const existing = findDuplicateUnit(targetUnits, u.title, u.term ?? null);
    if (existing) {
      const seen = new Set(lessonsOfUnit(targetLessons, existing.id).map((l) => normalizeTitle(l.title)));
      const toAdd = [];
      for (const t of titles) {
        const key = normalizeTitle(t);
        if (seen.has(key)) { skippedLessons += 1; continue; }
        seen.add(key);
        toAdd.push(t);
      }
      mergeUnits.push({ unitId: existing.id, title: existing.title, toAdd, startOrder: nextLessonOrder(targetLessons, existing.id) });
    } else {
      createUnits.push({ title: u.title, term: u.term ?? null, sort_order: order, lessons: titles });
      order += 1;
    }
  }

  const seenNone = new Set(lessonsOfUnit(targetLessons, null).map((l) => normalizeTitle(l.title)));
  const noUnit = [];
  for (const l of activeLessons(null)) {
    const key = normalizeTitle(l.title);
    if (seenNone.has(key)) { skippedLessons += 1; continue; }
    seenNone.add(key);
    noUnit.push(l.title);
  }
  const addedLessons = createUnits.reduce((s, u) => s + u.lessons.length, 0) + mergeUnits.reduce((s, u) => s + u.toAdd.length, 0) + noUnit.length;
  return { createUnits, mergeUnits, noUnit, noUnitStart: nextLessonOrder(targetLessons, null), skippedLessons, addedLessons, addedUnits: createUnits.length };
}

// ---------- الترم الحالي ----------

/** قيمة app_settings.current_term: { term: 1 } أو { term: 2 }. أي حاجة تانية = غير محدد */
export function currentTermOf(value) {
  const t = value && typeof value === 'object' ? Number(value.term) : NaN;
  return t === 1 || t === 2 ? t : null;
}

// ---------- كارت التغطية ----------

/** تحويل صفوف view الإحصائيات (units_count, no_unit_visible, no_unit_hidden) لخريطة */
export function unitStatsMap(rows) {
  const map = {};
  for (const r of rows || []) map[r.subject_id] = { units: Number(r.units_count) || 0, noUnitVisible: Number(r.no_unit_visible) || 0, noUnitHidden: Number(r.no_unit_hidden) || 0 };
  return map;
}

export function unitCoverage(subjects, unitStats) {
  let withUnits = 0;
  let noUnitLessons = 0;
  for (const s of subjects) {
    const st = unitStats[s.id];
    if (!st) continue;
    if (st.units > 0) withUnits += 1;
    noUnitLessons += st.noUnitVisible;
  }
  return { withUnits, noUnitLessons, total: subjects.length };
}

/** احتياطي لو view إحصائيات الوحدات مش موجودة: عدّ يدوي من الوحدات والدروس اللي من غير وحدة */
export function unitStatsFallback(unitRows, noUnitLessonRows) {
  const map = {};
  const entry = (id) => (map[id] ||= { units: 0, noUnitVisible: 0, noUnitHidden: 0 });
  for (const u of unitRows || []) entry(u.subject_id).units += 1;
  for (const l of noUnitLessonRows || []) {
    if (l.is_active) entry(l.subject_id).noUnitVisible += 1; else entry(l.subject_id).noUnitHidden += 1;
  }
  return map;
}
