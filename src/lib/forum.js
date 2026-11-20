// مساعدات المنتدى (نقية من غير React ولا Supabase) عشان تتختبر لوحدها.

/** تاريخ ووقت بتوقيت القاهرة بالعربي: "١٩ نوفمبر ٣:١٨ م" */
export function formatCairoDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
}

/** دور كاتب الرد: [لون الشارة، النص] أو null للطالب العادي (مفيش شارة) */
export const ROLE_STAMP = {
  admin: ['accent', 'أدمن'],
  moderator: ['ink', 'مشرف'],
};

/** القيم الفريدة غير الفاضية لعمود معيّن (لجلب أسماء/أدوار الكتّاب بطلب واحد) */
export const uniqueValues = (rows, key) => [...new Set((rows || []).map((r) => r?.[key]).filter(Boolean))];

/**
 * عمود صورة الكاتب في صف منتدى حقيقي (مثلًا author_avatar_url)، أو null لو مفيش.
 * بنكتشفه من صف موجود بدل ما نخمّن اسم العمود، لأن جدول المنتدى معرّف في ريبو التطبيق مش هنا.
 * الأولوية لاسم بيبدأ بـ author لأن عمود avatar_url لوحده ممكن يبقى بتاع حاجة تانية.
 */
export function avatarColumnOf(row) {
  if (!row || typeof row !== 'object') return null;
  const keys = Object.keys(row).filter((k) => /avatar|photo|picture|image/i.test(k));
  return keys.find((k) => /^author/i.test(k)) || keys[0] || null;
}

/** فيد آخر الردود: كل رد معاه عنوان السؤال وصاحبه ودور المُجيب */
export function buildReplyFeed(replies, threads, roles) {
  const byThread = new Map((threads || []).map((t) => [t.id, t]));
  return (replies || []).map((r) => {
    const thread = byThread.get(r.thread_id) || null;
    return {
      id: r.id,
      threadId: r.thread_id,
      threadTitle: thread?.title || null,
      askerName: thread?.author_name || null,
      askerId: thread?.author_id || null,
      authorId: r.author_id || null,
      authorName: r.author_name || 'مستخدم',
      role: roles?.[r.author_id] || null,
      body: r.body || '',
      createdAt: r.created_at,
    };
  });
}
