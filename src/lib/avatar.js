// فحص رابط صورة الأدمن قبل حفظه في profiles.avatar_url (نفس سقف حارس user_stats: ١٠٠٠ حرف)
export const AVATAR_URL_MAX = 1000;

/** رسالة المشكلة أو null لو الرابط سليم */
export function avatarUrlProblem(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return 'الرابط فاضي';
  if (url.length > AVATAR_URL_MAX) return `الرابط طويل أوي (أقصاه ${AVATAR_URL_MAX} حرف)`;
  if (/\s/.test(url)) return 'الرابط فيه مسافات';
  let parsed;
  try { parsed = new URL(url); } catch { return 'الرابط مش صحيح'; }
  if (parsed.protocol !== 'https:') return 'الرابط لازم يبدأ بـ https://';
  return null;
}
