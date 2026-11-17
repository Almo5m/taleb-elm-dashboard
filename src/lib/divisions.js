// التقسيم الدراسي (النظام / الصف / الشعبة): المصدر الوحيد في اللوحة.
// القيم لازم تكون نفس النص بالظبط اللي في التطبيق وقاعدة البيانات (sql: supabase_division_fix.sql).
// الجدول ده بيتحدّث كل صيف تقريبًا: عدّله هنا بس، وكل قوايم الاختيار في اللوحة بتتبني منه.
//
// ممنوع حقل كتابة حر لأي منهم، وممنوع تخزين توليفة مش موجودة هنا (زي «علمي علوم» في تانية ثانوية عامة).
// الشعبة في الصف الأول لازم تبقى null.

export const SYSTEMS = ['الثانوية العامة', 'البكالوريا المصرية', 'الأزهر الشريف'];
export const GRADES = ['الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];
export const FIRST_GRADE = GRADES[0];
export const SECOND_GRADE = GRADES[1];
export const THIRD_GRADE = GRADES[2];

const BAC_TRACKS = ['مسار الطب وعلوم الحياة', 'مسار الهندسة وعلوم الحاسب', 'مسار الأعمال', 'مسار الآداب والفنون'];

export const TRACKS = {
  'الثانوية العامة': {
    [SECOND_GRADE]: ['علمي', 'أدبي'],
    [THIRD_GRADE]: ['علمي علوم', 'علمي رياضة', 'أدبي'],
  },
  'البكالوريا المصرية': {
    [SECOND_GRADE]: BAC_TRACKS,
    [THIRD_GRADE]: BAC_TRACKS,
  },
  'الأزهر الشريف': {
    [SECOND_GRADE]: ['علمي', 'أدبي'],
    [THIRD_GRADE]: ['علمي', 'أدبي'],
  },
};

// الشعب المتاحة لنظام وصف. الصف الأول (أو أي قيمة مش معروفة) = قايمة فاضية
export function tracksFor(system, grade) {
  return TRACKS[system]?.[grade] ?? [];
}

// هل الصف ده فيه تشعيب؟ (كل الصفوف ما عدا الأول)
export function hasTracks(grade) {
  return GRADES.includes(grade) && grade !== FIRST_GRADE;
}

export function cleanTrack(track) {
  return track === undefined || track === null || String(track).trim() === '' ? null : track;
}

// توليفة سليمة؟ (النظام والصف من القايمة، والشعبة فاضية في الأول ومن المتاحة في الباقي)
export function isValidDivision({ system, grade, track }) {
  if (!SYSTEMS.includes(system) || !GRADES.includes(grade)) return false;
  const t = cleanTrack(track);
  if (!hasTracks(grade)) return t === null;
  return t !== null && tracksFor(system, grade).includes(t);
}

// حالة التقسيم: valid (سليم) | pending (النظام والصف سليمين والشعبة لسه فاضية في صف فيه تشعيب، وده
// طبيعي بعد الترقية: الطالب بيختارها من التطبيق) | invalid (قيمة مش من الجدول)
export function divisionStatus({ system, grade, track }) {
  if (isValidDivision({ system, grade, track })) return 'valid';
  if (SYSTEMS.includes(system) && hasTracks(grade) && cleanTrack(track) === null) return 'pending';
  return 'invalid';
}

// الطالب اختار شعبته؟ (الصف فيه تشعيب والشعبة لسه فاضية = "في انتظار اختيار الشعبة")
export function isPendingTrack(profile) {
  return hasTracks(profile.grade) && cleanTrack(profile.track) === null;
}

// لما النظام أو الصف يتغيّر، الشعبة تتصفّر لو بقت مش من المتاحة
export function reconcileTrack(system, grade, track) {
  const t = cleanTrack(track);
  return t !== null && tracksFor(system, grade).includes(t) ? t : null;
}

// كل التوليفات السليمة (20 توليفة) بالترتيب: نظام ← صف ← شعبة
export function allCombos() {
  const out = [];
  for (const system of SYSTEMS) {
    for (const grade of GRADES) {
      if (!hasTracks(grade)) out.push({ system, grade, track: null });
      else for (const track of tracksFor(system, grade)) out.push({ system, grade, track });
    }
  }
  return out;
}

export const comboKey = ({ system, grade, track }) => `${system}|${grade}|${cleanTrack(track) ?? ''}`;

export function divisionLabel({ system, grade, track }) {
  const parts = [system || '—', grade || '—'];
  if (cleanTrack(track)) parts.push(track);
  return parts.join(' • ');
}

// توزيع الطلاب: عدد لكل توليفة سليمة + في انتظار الشعبة (لكل نظام وصف) + أي توليفات مش سليمة (مع عددها)
export function distribution(profiles) {
  const counts = new Map();
  const pending = new Map();
  const invalid = new Map();
  let total = 0;
  for (const p of profiles) {
    if ((p.role || 'student') !== 'student') continue;
    total += 1;
    const d = { system: p.system, grade: p.grade, track: p.track };
    const key = comboKey({ system: d.system || '', grade: d.grade || '', track: d.track });
    const status = divisionStatus(d);
    if (status === 'valid') counts.set(key, (counts.get(key) || 0) + 1);
    else if (status === 'pending') {
      const pk = `${d.system}|${d.grade}`;
      pending.set(pk, { system: d.system, grade: d.grade, count: (pending.get(pk)?.count || 0) + 1 });
    } else invalid.set(key, { ...d, count: (invalid.get(key)?.count || 0) + 1 });
  }
  return {
    total,
    valid: allCombos().map((c) => ({ ...c, count: counts.get(comboKey(c)) || 0 })),
    pending: [...pending.values()],
    pendingCount: [...pending.values()].reduce((s, x) => s + x.count, 0),
    invalid: [...invalid.values()].sort((a, b) => b.count - a.count),
    invalidCount: [...invalid.values()].reduce((s, x) => s + x.count, 0),
  };
}
