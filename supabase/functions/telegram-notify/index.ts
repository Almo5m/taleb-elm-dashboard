// supabase/functions/telegram-notify/index.ts
//
// بيستقبل نداء من الـ Database Trigger (شوف sql/supabase_admin_improvements.sql)
// مع اسم الجدول ونوع الحدث وبيانات الصف، وبيبعت رسالة تليجرام منسّقة
// (HTML parse mode — عناوين بولد وأسطر واضحة).
//
// النشر:
//   supabase functions deploy telegram-notify
//
// الأسرار المطلوبة (Project Settings → Edge Functions → Secrets، أو CLI):
//   supabase secrets set TELEGRAM_BOT_TOKEN=...
//   supabase secrets set TELEGRAM_CHAT_ID=...
//   supabase secrets set WEBHOOK_SECRET=... (نفس القيمة المكتوبة في الـ SQL)
//   supabase secrets set DASHBOARD_URL=https://<رابط لوحة التحكم على Vercel>  (اختياري: لإضافة زرار "فتح في اللوحة" في رسائل المنتدى)

import {
  escapeHtml, formatForumReply, formatForumThread, type ForumContext, type WebhookPayload,
} from './format.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

function formatMessage({ table, event, record }: WebhookPayload, ctx: ForumContext, dashboardUrl: string | undefined): string {
  const actionAr = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' }[event] ?? event;
  const e = escapeHtml;

  switch (table) {
    case 'profiles':
      return `👤 <b>طالب جديد سجّل</b>\n\n<b>الاسم:</b> ${e(record.name)}\n<b>الإيميل:</b> ${e(record.email)}`;

    case 'forum_threads':
      return formatForumThread(record, ctx, dashboardUrl);

    case 'forum_replies':
      return formatForumReply(record, ctx, dashboardUrl);

    case 'forum_reports':
      return `🚩 <b>بلاغ جديد في المنتدى</b>\n\n<b>الحالة:</b> ${e(record.status)}\n<b>السبب:</b> ${e(record.reason)}`;

    case 'banned_words':
      return `🚫 <b>${e(actionAr)} كلمة محظورة</b>\n\n<b>الكلمة:</b> ${e(record.word)}`;

    case 'announcements':
      return `📢 <b>إعلان جديد اتنشر</b>\n\n${e(record.title ?? record.content)}`;

    case 'admin_audit_log':
      return `🛠️ <b>إجراء إداري</b>\n\n<b>الإجراء:</b> ${e(record.action)}\n<b>التفاصيل:</b> <code>${e(JSON.stringify(record.details ?? {}))}</code>`;

    case 'ai_access':
      return `🤖 <b>تغيير في صلاحية الذكاء الاصطناعي</b>\n\n<b>مفعّل:</b> ${e(record.enabled)}`;

    case 'app_settings':
      return `⚙️ <b>تعديل في إعدادات التطبيق</b>\n\n<b>المفتاح:</b> ${e(record.key)}\n<b>القيمة الجديدة:</b> <code>${e(JSON.stringify(record.value ?? ''))}</code>`;

    default:
      return `ℹ️ <b>${e(actionAr)}</b> في جدول <code>${e(table)}</code>`;
  }
}

// بيانات المنتدى الناقصة في الـ webhook: عنوان السؤال وصاحبه (للرد) ودور كاتب الرد/السؤال.
// best-effort بمفتاح service role: لو أي جلب فشل الرسالة بتتبعت بالمتاح بدل ما تقع.
async function loadForumContext(payload: WebhookPayload): Promise<ForumContext> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return {};
  if (payload.table !== 'forum_replies' && payload.table !== 'forum_threads') return {};

  const get = async (path: string): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!res.ok) return null;
      const rows = await res.json();
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    } catch (err) {
      console.log('forum context fetch failed:', err);
      return null;
    }
  };
  // الـ id بيتحط في الرابط، فبنقبل شكل UUID/رقم بس
  const safe = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && /^[A-Za-z0-9-]{1,64}$/.test(String(v)) ? String(v) : null;

  const ctx: ForumContext = {};
  const authorId = safe(payload.record.author_id);
  const threadId = payload.table === 'forum_replies' ? safe(payload.record.thread_id) : null;
  const [thread, author] = await Promise.all([
    threadId ? get(`forum_threads?id=eq.${threadId}&select=id,title,author_name`) : Promise.resolve(null),
    authorId ? get(`profiles?id=eq.${authorId}&select=role`) : Promise.resolve(null),
  ]);
  if (thread) ctx.thread = thread as ForumContext['thread'];
  if (author && typeof author.role === 'string') ctx.authorRole = author.role;
  return ctx;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const secret = req.headers.get('x-webhook-secret');
  if (!secret || secret !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response(JSON.stringify({ error: 'مفيش تفويض' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload: WebhookPayload = await req.json();
    const ctx = await loadForumContext(payload);
    const text = formatMessage(payload, ctx, Deno.env.get('DASHBOARD_URL'));

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });

    if (!telegramResponse.ok) {
      const errorText = await telegramResponse.text();
      console.log('Telegram send failed:', telegramResponse.status, errorText);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.log('telegram-notify error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
