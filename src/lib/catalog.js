// منطق صفحة "دروس المنهج" (نقي، من غير React ولا Supabase) عشان يتختبر لوحده.
// الداتا: catalog_subjects (مواد كل تقسيم) و catalog_lessons (دروس كل مادة). الأدمن بيكتب والطالب بينسخ لنفسه.
import { GRADES, SYSTEMS, cleanTrack, hasTracks, tracksFor } from './divisions.js';

export const TITLE_MAX = 200;
export const SUBJECT_NAME_MAX = 120;
export const WARN_VISIBLE = 400; // التطبيق بياخد 500 درس بحد أقصى للمادة
export const APP_MAX = 500;

// نفس قاعدة السيرفر في منع التكرار: قص المسافات وتجاهل حالة الأحرف
export const normalizeTitle = (t) => String(t ?? '').trim().toLowerCase();

export const isUniqueViolation = (error) =>
  !!error && (error.code === '23505' || /duplicate key|unique constraint/i.test(error.message || ''));

export const isMissingRelation = (error) => {
  if (!error) return false;
  const text = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return error.code === '42P01' || error.code === 'PGRST205' || text.includes('does not exist') || text.includes('could not find the table') || text.includes('schema cache');
};

export function validateTitle(title) {
  const t = String(title ?? '').trim();
  if (!t) return 'اكتب عنوان الدرس';
  if (t.length > TITLE_MAX) return `العنوان أطول من ${TITLE_MAX} حرف`;
  return null;
}

// الإضافة المجمّعة: كل سطر درس. بنتجاهل الفاضي ونقص المسافات ونتخطى المكرر (جوه الصندوق أو الموجود)
export function parseBulkLines(text, existingTitles = []) {
  const seen = new Set(existingTitles.map(normalizeTitle));
  const toAdd = [];
  let duplicates = 0;
  let tooLong = 0;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length > TITLE_MAX) { tooLong += 1; continue; }
    const key = normalizeTitle(line);
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    toAdd.push(line);
  }
  return { toAdd, duplicates, tooLong, skipped: duplicates + tooLong };
}

export const nextSortOrder = (lessons) => lessons.reduce((m, l) => Math.max(m, Number(l.sort_order) || 0), 0) + 1;

export function buildInsertRows(subjectId, titles, startOrder) {
  return titles.map((title, i) => ({ subject_id: subjectId, title, sort_order: startOrder + i, is_active: true }));
}

export function lessonStats(lessons) {
  const visible = lessons.filter((l) => l.is_active).length;
  return { visible, hidden: lessons.length - visible, total: lessons.length };
}

// تحريك درس بسهم (dir = -1 فوق، +1 تحت). بيرجّع قايمة جديدة (أو نفسها لو مفيش حركة ممكنة)
export function moveItem(list, index, dir) {
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const copy = [...list];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
}

// الترتيب بيتكتب للقايمة كلها بأرقام متتالية من 1، في عملية واحدة (upsert بالـ id)
export function reorderRows(lessons) {
  return lessons.map((l, i) => ({ id: l.id, subject_id: l.subject_id, title: l.title, is_active: l.is_active, sort_order: i + 1 }));
}

export const orderChanged = (original, current) => original.length !== current.length || original.some((l, i) => l.id !== current[i].id);

// مواد تقسيم معيّن. الصف الأول والمواد العامة للصف: track = null
export function subjectsFor(subjects, { system, grade, track }) {
  const t = cleanTrack(track);
  return subjects
    .filter((s) => s.system === system && s.grade === grade && cleanTrack(s.track) === t)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.subject_name).localeCompare(String(b.subject_name), 'ar'));
}

// اختيارات الشعبة في التنقل: «عامة للصف» (null) + شعب النظام والصف. الصف الأول = null بس
export function trackChoices(system, grade) {
  return hasTracks(grade) ? [null, ...tracksFor(system, grade)] : [null];
}

export const trackLabel = (track) => cleanTrack(track) ?? 'مواد عامة للصف';

// عدد مواد فيها دروس ظاهرة من الإجمالي، لكل نظام وصف (كل الشعب مع بعض)
export function coverage(subjects, stats) {
  const out = [];
  for (const system of SYSTEMS) {
    for (const grade of GRADES) {
      const list = subjects.filter((s) => s.system === system && s.grade === grade);
      const covered = list.filter((s) => (stats[s.id]?.visible || 0) > 0).length;
      out.push({ system, grade, total: list.length, covered, pct: list.length ? Math.round((covered / list.length) * 100) : 0 });
    }
  }
  return out;
}

// تحويل صفوف الإحصائيات (view أو عدّ يدوي) لخريطة id ← { visible, hidden }
export function statsMap(rows) {
  const map = {};
  for (const r of rows || []) map[r.subject_id] = { visible: Number(r.visible_count) || 0, hidden: Number(r.hidden_count) || 0 };
  return map;
}

// عدّ يدوي من صفوف الدروس (احتياطي لو الـ view مش موجودة)
export function statsFromLessons(rows) {
  const map = {};
  for (const r of rows || []) {
    const e = (map[r.subject_id] ||= { visible: 0, hidden: 0 });
    if (r.is_active) e.visible += 1; else e.hidden += 1;
  }
  return map;
}

// فورم المادة: النظام والصف من القوايم الحرفية، والشعبة null (الأول أو عامة) أو من المتاحة
export function validateSubjectForm({ system, grade, track, name }, existing = []) {
  if (!SYSTEMS.includes(system)) return 'اختار النظام';
  if (!GRADES.includes(grade)) return 'اختار الصف';
  const t = cleanTrack(track);
  if (!hasTracks(grade) && t !== null) return 'الصف الأول من غير شعبة';
  if (t !== null && !tracksFor(system, grade).includes(t)) return 'الشعبة مش متاحة لنظام وصف زي دول';
  const n = String(name ?? '').trim();
  if (!n) return 'اكتب اسم المادة';
  if (n.length > SUBJECT_NAME_MAX) return `الاسم أطول من ${SUBJECT_NAME_MAX} حرف`;
  const key = n.toLowerCase();
  if (existing.some((s) => s.system === system && s.grade === grade && cleanTrack(s.track) === t && String(s.subject_name).trim().toLowerCase() === key)) {
    return 'المادة دي موجودة بالفعل في نفس التقسيم';
  }
  return null;
}

// تجميع المواد للاختيار في نافذة النسخ: نظام ← صف ← شعبة
export function groupSubjects(subjects, { excludeId = null, query = '' } = {}) {
  const q = query.trim().toLowerCase();
  const groups = new Map();
  for (const s of subjects) {
    if (s.id === excludeId) continue;
    if (q && !String(s.subject_name).toLowerCase().includes(q)) continue;
    const key = `${s.system}|${s.grade}|${cleanTrack(s.track) ?? ''}`;
    if (!groups.has(key)) groups.set(key, { key, system: s.system, grade: s.grade, track: cleanTrack(s.track), subjects: [] });
    groups.get(key).subjects.push(s);
  }
  const order = (g) => SYSTEMS.indexOf(g.system) * 100 + GRADES.indexOf(g.grade) * 10;
  return [...groups.values()].sort((a, b) => order(a) - order(b) || String(a.track ?? '').localeCompare(String(b.track ?? ''), 'ar'));
}

// نسخ دروس لمادة: بيتخطى المكرر وبيضيف بعد آخر ترتيب في المادة الهدف
export function planCopy(sourceTitles, targetExisting) {
  const seen = new Set(targetExisting.map((l) => normalizeTitle(l.title)));
  const toAdd = [];
  let skipped = 0;
  for (const t of sourceTitles) {
    const key = normalizeTitle(t);
    if (seen.has(key)) { skipped += 1; continue; }
    seen.add(key);
    toAdd.push(t);
  }
  return { toAdd, skipped, startOrder: nextSortOrder(targetExisting) };
}
