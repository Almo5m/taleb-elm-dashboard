// supabase/functions/telegram-notify/index.ts
//
// بيستقبل نداء من الـ Database Trigger (شوف supabase_admin_improvements.sql)
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

interface WebhookPayload {
  table: string;
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  record: Record<string, unknown>;
}

// Telegram HTML parse mode بيرفض الرسالة كلها لو فيها < أو > أو & غير متعامل
// معاها صح — أي قيمة جاية من الداتابيز (اسم طالب، عنوان موضوع...) لازم
// تتعامل معاها كنص خام، مش HTML، عشان محتوى المستخدم مايكسرش شكل الرسالة
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMessage({ table, event, record }: WebhookPayload): string {
  const actionAr = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' }[event] ?? event;
  const e = escapeHtml;

  switch (table) {
    case 'profiles':
      return `👤 <b>طالب جديد سجّل</b>\n\n<b>الاسم:</b> ${e(record.name)}\n<b>الإيميل:</b> ${e(record.email)}`;

    case 'forum_threads':
      return `💬 <b>موضوع جديد في المنتدى</b>\n\n<b>العنوان:</b> ${e(record.title)}`;

    case 'forum_replies':
      return `↩️ <b>رد جديد في المنتدى</b>\n\nعلى موضوع: <code>${e(record.thread_id)}</code>`;

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
    const text = formatMessage(payload);

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
