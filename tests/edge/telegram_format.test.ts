import { escapeHtml, formatForumReply, formatForumThread, snippet, threadLink } from '../../supabase/functions/telegram-notify/format.ts';
import { eq as eqBase, ok as okBase } from './assert.ts';

// الرسالة اختيارية هنا (الـ assert الأساسي بيطلبها)
const eq = <T>(actual: T, expected: T, msg = 'قيمة غير متوقعة') => eqBase(actual, expected, msg);
const ok = (cond: unknown, msg = 'الشرط فشل') => okBase(cond, msg);

const URL_BASE = 'https://taleb-dashboard.vercel.app';

Deno.test('مقتطف النص: قص بالحروف الكاملة وتنضيف الأسطر', () => {
  eq(snippet('سطر١\n\n\nسطر٢   تالت'), 'سطر١ سطر٢ تالت', 'الأسطر والمسافات بتتجمّع');
  eq(snippet(''), '—');
  eq(snippet(null), '—');
  const long = 'أ'.repeat(300);
  eq(Array.from(snippet(long, 240)).length, 241, '٢٤٠ حرف + علامة القص');
  ok(snippet(long, 240).endsWith('…'));
  // إيموجي (حرفين في UTF-16) مبيتقصش في النص
  const emoji = '😀'.repeat(300);
  ok(!snippet(emoji, 10).includes('\uFFFD') && Array.from(snippet(emoji, 10)).length === 11, 'القص مش بيكسر الإيموجي');
});

Deno.test('رابط الموضوع: https بس ومعرّف نضيف', () => {
  eq(threadLink(URL_BASE, 'abc-123'), `${URL_BASE}/forum?thread=abc-123`);
  eq(threadLink(`${URL_BASE}/`, 42), `${URL_BASE}/forum?thread=42`, 'الشرطة الزيادة بتتشال');
  eq(threadLink(undefined, 'abc'), '', 'من غير DASHBOARD_URL مفيش رابط');
  eq(threadLink('http://insecure.example', 'abc'), '', 'http مرفوض');
  eq(threadLink('javascript:alert(1)', 'abc'), '');
  eq(threadLink(URL_BASE, 'a"><b'), '', 'معرّف غريب مرفوض');
  eq(threadLink(URL_BASE, ''), '');
});

Deno.test('رسالة سؤال جديد: مين سأل وعن إيه ومعاها رابط', () => {
  const text = formatForumThread(
    { id: 'thr-1', title: 'ازاي احل <معادلة>؟', author_name: 'أحمد & علي', grade: 'الصف الثاني الثانوي', subject_name: 'رياضيات', body: 'محتاج شرح\nالدرس التالت' },
    {}, URL_BASE,
  );
  ok(text.includes('<b>السائل:</b> أحمد &amp; علي'), 'اسم السائل متهرّب منه');
  ok(text.includes('ازاي احل &lt;معادلة&gt;؟'), 'العنوان متهرّب منه');
  ok(text.includes('الصف الثاني الثانوي · رياضيات'));
  ok(text.includes('محتاج شرح الدرس التالت'), 'مقتطف النص');
  ok(text.includes(`href="${URL_BASE}/forum?thread=thr-1"`), 'الرابط');
  ok(!text.includes('<معادلة>'), 'مفيش HTML خام من المستخدم');
});

Deno.test('رسالة رد: المُجيب والسؤال وصاحبه، ورد الإدارة متمّيز', () => {
  const student = formatForumReply(
    { thread_id: 'thr-1', author_name: 'منى', body: 'جرّب تحل بالتحليل' },
    { thread: { title: 'سؤال في الجبر', author_name: 'أحمد' }, authorRole: 'student' }, URL_BASE,
  );
  ok(student.includes('رد جديد في المنتدى'));
  ok(student.includes('<b>المُجيب:</b> منى\n'), 'من غير وسم دور للطالب');
  ok(student.includes('<b>على سؤال:</b> سؤال في الجبر'));
  ok(student.includes('<b>صاحب السؤال:</b> أحمد'));
  ok(student.includes('thread=thr-1'));

  const admin = formatForumReply(
    { thread_id: 'thr-1', author_name: 'معاذ', body: 'تمام' },
    { thread: { title: 'سؤال', author_name: 'أحمد' }, authorRole: 'admin' },
  );
  ok(admin.includes('رد من الإدارة في المنتدى'));
  ok(admin.includes('معاذ (أدمن)'));
  ok(!admin.includes('href='), 'من غير DASHBOARD_URL مفيش رابط');
});

Deno.test('رسالة رد لما جلب السؤال يفشل: بترجع للرقم بدل ما تقع', () => {
  const text = formatForumReply({ thread_id: 'thr-9', author_name: 'منى', body: 'رد' }, {}, URL_BASE);
  ok(text.includes('<b>على موضوع رقم:</b> <code>thr-9</code>'));
  ok(text.includes('thread=thr-9'));
  ok(!text.includes('صاحب السؤال'));
  eq(escapeHtml(undefined), '—');
});

Deno.test('طول الرسالة بعيد عن حد تليجرام (٤٠٩٦)', () => {
  const text = formatForumReply(
    { thread_id: 'x', author_name: 'ا'.repeat(500), body: 'ب'.repeat(5000) },
    { thread: { title: 'ج'.repeat(3000), author_name: 'د'.repeat(500) } }, URL_BASE,
  );
  ok(text.length < 4096, `الطول ${text.length}`);
});
