// فحص تحذيري لـ contact_links: دي الروابط اللي بيفتحها زرار "تواصل مع الأدمن" عند طالب بو مش مفعّل عنده.
// تحذير بس، مبيمنعش الحفظ (التطبيق هو اللي بيحدد شكل كل رابط).

// الوسايل اللي الطالب يقدر يطلب بيها تفعيل بو أو اشتراك
const REACH_KEYS = ['whatsapp', 'telegram_personal', 'email', 'instagram', 'facebook'];

export function contactWarnings(contact) {
  const warnings = [];
  const value = (key) => (typeof contact?.[key] === 'string' ? contact[key].trim() : '');
  if (!REACH_KEYS.some((k) => value(k))) {
    warnings.push('مفيش ولا وسيلة تواصل مباشرة (واتساب، تليجرام شخصي، إيميل، إنستجرام، فيسبوك). الطالب اللي بو مش مفعّل عنده مش هيعرف يوصلك.');
  }
  for (const [key, label] of [['whatsapp', 'واتساب'], ['telegram_personal', 'تليجرام شخصي'], ['instagram', 'إنستجرام'], ['facebook', 'فيسبوك']]) {
    const v = value(key);
    if (v && !/^https:\/\//i.test(v)) warnings.push(`${label}: الرابط لازم يبدأ بـ https://`);
  }
  const email = value('email');
  if (email && !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) warnings.push('الإيميل: لازم يكون بالشكل mailto:name@example.com');
  return warnings;
}
