// منطق العمليات الجماعية على الطلاب (نقي، من غير React ولا Supabase) عشان يتختبر لوحده.
// القاعدة: العملية الجماعية بتستهدف الطلاب بس (role = student)، مش الأدمن ولا المشرفين، في أي نطاق.

export const BULK_SCOPES = [
  { key: 'selected', label: 'المحدَّدين' },
  { key: 'filtered', label: 'المطابقين للفلتر الحالي' },
  { key: 'all', label: 'كل الطلاب' },
];

export const BULK_ACTIONS = [
  { key: 'ai_on', label: 'تفعيل المساعد الذكي', danger: false },
  { key: 'ai_off', label: 'إيقاف المساعد الذكي', danger: true },
  { key: 'ai_reset_limit', label: 'مسح الحد اليومي المخصص (يرجع للافتراضي)', danger: false },
  { key: 'ban', label: 'حظر', danger: true },
  { key: 'unban', label: 'فك الحظر', danger: false },
];

export const isStudent = (p) => (p?.role || 'student') === 'student';

/** الطلاب المستهدفين في النطاق ده (ids). filteredIds: ids المطابقين للفلتر الحالي، selected: Set أو مصفوفة */
export function scopeTargets(profiles, scope, { selected = [], filteredIds = [] } = {}) {
  const students = (profiles || []).filter(isStudent);
  if (scope === 'all') return students.map((p) => p.id);
  const wanted = new Set(scope === 'selected' ? [...selected] : filteredIds);
  return students.filter((p) => wanted.has(p.id)).map((p) => p.id);
}

/**
 * الخطة الفعلية لعملية: اللي هيتنفّذ عليهم، واللي هيتخطّوا لأنهم في الحالة دي أصلًا.
 * aiAccess: { [user_id]: { enabled, daily_limit_override } } (مفيش صف = المساعد مش مفعّل).
 */
export function planBulkAction(action, ids, profiles, aiAccess = {}) {
  const byId = new Map((profiles || []).map((p) => [p.id, p]));
  const already = (id) => {
    const ai = aiAccess[id];
    switch (action) {
      case 'ai_on': return !!ai?.enabled;
      case 'ai_off': return !ai?.enabled;
      case 'ai_reset_limit': return ai?.daily_limit_override == null;
      case 'ban': return !!byId.get(id)?.banned;
      case 'unban': return !byId.get(id)?.banned;
      default: return false;
    }
  };
  const run = [];
  let skipped = 0;
  for (const id of ids) (already(id) ? (skipped += 1) : run.push(id));
  return { ids: run, skipped };
}
