// supabase/functions/telegram-notify/index.ts
//
// بيستقبل نداء من الـ Database Trigger (شوف supabase_admin_improvements.sql)
// مع اسم الجدول ونوع الحدث وبيانات الصف، وبيبعت رسالة تليجرام واضحة.
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

function formatMessage({ table, event, record }: WebhookPayload): string {
  const actionAr = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' }[event] ?? event;

  switch (table) {
    case 'profiles':
      return `👤 طالب جديد سجّل في طالب علم\nالاسم: ${record.name ?? '—'}\nالإيميل: ${record.email ?? '—'}`;

    case 'forum_threads':
      return `💬 موضوع جديد في المنتدى\nالعنوان: ${record.title ?? '—'}`;

    case 'forum_replies':
      return `↩️ رد جديد في المنتدى على موضوع: ${record.thread_id ?? '—'}`;

    case 'forum_reports':
      return `🚩 بلاغ جديد في المنتدى\nالحالة: ${record.status ?? '—'}\nالسبب: ${record.reason ?? '—'}`;

    case 'banned_words':
      return `🚫 ${actionAr} كلمة محظورة: ${record.word ?? '—'}`;

    case 'announcements':
      return `📢 إعلان جديد اتنشر: ${record.title ?? record.content ?? '—'}`;

    case 'admin_audit_log':
      return `🛠️ إجراء إداري: ${record.action ?? '—'}\nالتفاصيل: ${JSON.stringify(record.details ?? {})}`;

    case 'ai_access':
      return `🤖 تغيير في صلاحية الذكاء الاصطناعي لطالب\nمفعّل: ${record.enabled ?? '—'}`;

    case 'app_settings':
      return `⚙️ تعديل في إعدادات التطبيق\nالمفتاح: ${record.key ?? '—'}\nالقيمة الجديدة: ${JSON.stringify(record.value ?? '')}`;

    default:
      return `ℹ️ ${actionAr} في جدول ${table}`;
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
      body: JSON.stringify({ chat_id: chatId, text }),
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
