// منطق صفحة "أسئلة الطلاب لبو" (نقي) عشان يتختبر لوحده.

export const QUESTION_PAGE_SIZE = 40;
export const CATEGORIES = ['منهج', 'خارج النطاق', 'غير مصنّف'];

/** نص البحث بعد ما نشيل الحروف اللي بتبوّظ فلتر ilike أو بتشتغل كـ wildcard */
export function cleanSearch(text) {
  return String(text ?? '').replace(/[%_*\\,()"']/g, ' ').replace(/\s+/g, ' ').trim();
}

/** لون شارة التصنيف */
export function categoryTone(category) {
  if (category === 'منهج') return 'forest';
  if (category === 'خارج النطاق') return 'coral';
  return 'amber';
}

/** السؤال طويل ومحتاج "عرض الكل"؟ (سطور كتير أو حروف كتير) */
export function isLongQuestion(text, maxChars = 220, maxLines = 4) {
  const t = String(text ?? '');
  return t.length > maxChars || t.split('\n').length > maxLines;
}

/** اسم الطالب من خريطة الأسماء، مع بديل لو الحساب اتمسح */
export const studentName = (names, userId) => names?.[userId] || 'حساب محذوف';
