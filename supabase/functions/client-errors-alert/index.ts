// supabase/functions/client-errors-alert/index.ts
//
// بتتنادى من pg_cron كل 30 دقيقة (شوف supabase_client_errors_alert.sql).
// لو عدد تقارير الأعطال في آخر 30 دقيقة وصل للحد (THRESHOLD)، بتبعت رسالة
// تليجرام واحدة فيها أكتر الرسايل تكرارًا. عمدًا مفيش تنبيه لكل صف: الجدول
// بيقبل إدخال مجهول، فتنبيه لكل صف كان هيغرق تليجرام لو حد أغرق الجدول.
// الفاصل الزمني نفسه هو الـ debounce (رسالة واحدة كحد أقصى كل 30 دقيقة).
//
// النشر: supabase functions deploy client-errors-alert
// (بتستخدم نفس WEBHOOK_SECRET و TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID الموجودين)

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

const WINDOW_MINUTES = 30;
const THRESHOLD = 20; // عدّل الرقم ده حسب حجم الاستخدام

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// محتوى الأعطال جاي من أجهزة مجهولة — لازم يتعمله escape قبل ما يدخل رسالة
// HTML في تليجرام، وإلا ممكن يكسر الرسالة أو يحقن وسوم
function escapeHtml(value: unknown): string {
  return String(value ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

Deno.serve(async (req) => {
  // الفنكشن دي بتتنادى من pg_cron بس، فالسر إلزامي (مفيش مسار بدون سر)
  const secret = req.headers.get('x-webhook-secret');
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return jsonResponse({ error: 'مفيش تفويض' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('client_errors')
    .select('device_id, message')
    .gte('created_at', since)
    .limit(1000);

  if (error) {
    console.error('client-errors-alert query error:', error);
    return jsonResponse({ error: error.message }, 500);
  }

  const rows = data ?? [];
  if (rows.length < THRESHOLD) {
    return jsonResponse({ ok: true, alerted: false, count: rows.length });
  }

  const groups = new Map<string, { count: number; devices: Set<string> }>();
  for (const r of rows) {
    const key = (r.message ?? '(بدون رسالة)').slice(0, 120);
    const g = groups.get(key) ?? { count: 0, devices: new Set<string>() };
    g.count += 1;
    g.devices.add(r.device_id);
    groups.set(key, g);
  }

  const top = [...groups.entries()]
    .sort((a, b) => b[1].devices.size - a[1].devices.size || b[1].count - a[1].count)
    .slice(0, 3)
    .map(([msg, g], i) => `${i + 1}. <code>${escapeHtml(msg)}</code>\n   ${g.devices.size} جهاز · ${g.count} مرة`)
    .join('\n');

  const text =
    `⚠️ <b>ارتفاع في أعطال التطبيق</b>\n\n` +
    `<b>${rows.length}</b> تقرير في آخر ${WINDOW_MINUTES} دقيقة (الحد: ${THRESHOLD})\n\n` +
    `<b>أكتر الأعطال:</b>\n${top}`;

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) console.error('Telegram send failed:', res.status, await res.text());
  }

  return jsonResponse({ ok: true, alerted: true, count: rows.length });
});
