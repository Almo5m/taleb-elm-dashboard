// تنسيق رسائل تليجرام (دوال نقية من غير شبكة، عشان تتختبر). الاستخدام من index.ts.
//
// الهدف في المنتدى: الأدمن يعرف من الرسالة لوحدها مين سأل وعن إيه، ومين رد وعلى أنهي سؤال،
// ويفتح الموضوع بضغطة (بدل رقم الموضوع اللي مكانش بيقول حاجة).

export interface WebhookPayload {
  table: string;
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  record: Record<string, unknown>;
}

// بيانات إضافية بتتجاب من الداتابيز قبل التنسيق (ممكن تفضل فاضية لو الجلب فشل)
export interface ForumContext {
  thread?: { id?: unknown; title?: unknown; author_name?: unknown; grade?: unknown; subject_name?: unknown } | null;
  authorRole?: string | null; // دور اللي كتب الرد/السؤال: admin | moderator | student
}

export const SNIPPET_MAX = 240;

// Telegram HTML parse mode بيرفض الرسالة كلها لو فيها < أو > أو & غير متعامل معاها، فكل قيمة جاية
// من الداتابيز (اسم طالب، عنوان، نص) لازم تتعامل معاها كنص خام مش HTML
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** مقتطف من النص: بيقص بالحروف الكاملة (مش نص إيموجي)، وبيشيل الأسطر الفاضية الكتير */
export function snippet(value: unknown, max = SNIPPET_MAX): string {
  const text = String(value ?? '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!text) return '—';
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('').trimEnd()}…`;
}

const ROLE_LABEL: Record<string, string> = { admin: 'أدمن', moderator: 'مشرف' };

/** رابط الموضوع في اللوحة (لو DASHBOARD_URL متضبط). بيرجّع '' لو مفيش رابط صالح */
export function threadLink(dashboardUrl: string | undefined | null, threadId: unknown): string {
  const base = (dashboardUrl ?? '').trim().replace(/\/+$/, '');
  const id = String(threadId ?? '').trim();
  if (!/^https:\/\//i.test(base) || !id || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return '';
  return `${base}/forum?thread=${encodeURIComponent(id)}`;
}

function linkLine(url: string): string {
  return url ? `\n\n<a href="${escapeHtml(url).replace(/"/g, '&quot;')}">فتح في اللوحة</a>` : '';
}

export function formatForumThread(record: Record<string, unknown>, ctx: ForumContext = {}, dashboardUrl?: string | null): string {
  const e = escapeHtml;
  const lines = [
    '💬 <b>سؤال جديد في المنتدى</b>',
    '',
    `<b>العنوان:</b> ${e(snippet(record.title, 150))}`,
    `<b>السائل:</b> ${e(record.author_name)}`,
  ];
  const where = [record.grade, record.subject_name].filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
  if (where.length) lines.push(`<b>القسم:</b> ${where.map(e).join(' · ')}`);
  lines.push('', e(snippet(record.body)));
  return lines.join('\n') + linkLine(threadLink(dashboardUrl, record.id));
}

export function formatForumReply(record: Record<string, unknown>, ctx: ForumContext = {}, dashboardUrl?: string | null): string {
  const e = escapeHtml;
  const role = ROLE_LABEL[ctx.authorRole ?? ''];
  const t = ctx.thread;
  const who = `${e(record.author_name)}${role ? ` (${role})` : ''}`;
  const lines = [
    role ? '↩️ <b>رد من الإدارة في المنتدى</b>' : '↩️ <b>رد جديد في المنتدى</b>',
    '',
    `<b>المُجيب:</b> ${who}`,
  ];
  if (t?.title) {
    lines.push(`<b>على سؤال:</b> ${e(snippet(t.title, 150))}`);
    if (t.author_name) lines.push(`<b>صاحب السؤال:</b> ${e(t.author_name)}`);
  } else {
    // الجلب فشل أو الموضوع اتمسح: على الأقل نوصل الرقم
    lines.push(`<b>على موضوع رقم:</b> <code>${e(record.thread_id)}</code>`);
  }
  lines.push('', e(snippet(record.body)));
  return lines.join('\n') + linkLine(threadLink(dashboardUrl, record.thread_id));
}
