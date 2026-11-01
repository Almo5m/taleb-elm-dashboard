// تحقق صارم من روابط بتتعرض للطلاب (صفحات قانونية، مشاركة التطبيق): https فقط،
// وURL صالح فيه hostname حقيقي. بيرجّع { ok: true, value } أو { ok: false, error }.

const MAX_URL_LENGTH = 2048;

export function validateHttpsUrl(input) {
  const value = String(input ?? '').trim();

  if (!value) return { ok: false, error: 'الرابط فاضي' };
  if (value.length > MAX_URL_LENGTH) return { ok: false, error: `الرابط أطول من ${MAX_URL_LENGTH} حرف` };
  if (/\s/.test(value)) return { ok: false, error: 'الرابط فيه مسافات' };
  // الباك سلاش والرموز غير المرئية بتتفسّر بشكل مختلف بين المتصفحات (خدعة شهيرة لتمويه الدومين)
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: 'الرابط فيه رموز غير مسموحة' };
  // new URL بيقبل "https:example.com" (من غير //)، فبنتأكد من الشكل الكامل بنفسنا
  if (!/^https:\/\//i.test(value)) return { ok: false, error: 'لازم الرابط يبدأ بـ https://' };

  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'الرابط غير صالح — اكتبه كامل زي https://example.com' };
  }

  if (url.protocol !== 'https:') return { ok: false, error: 'لازم الرابط يبدأ بـ https://' };
  if (url.username || url.password) return { ok: false, error: 'الرابط مينفعش يحتوي على اسم مستخدم أو كلمة سر' };

  const host = url.hostname;
  if (!host || !host.includes('.')) return { ok: false, error: 'اسم الموقع (hostname) غير صالح' };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, error: 'استخدم اسم موقع مش عنوان IP' };

  return { ok: true, value };
}
