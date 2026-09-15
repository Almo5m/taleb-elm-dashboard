// supabase/functions/weekly-report/index.ts
//
// بتتنادى مرة كل أسبوع (شوف supabase_backend_improvements_v3.sql) من
// pg_cron، وبتبعت ملخص أسبوعي على تليجرام: طلاب جدد، أكتر طالب استخدامًا
// للـ AI، بلاغات الأسبوع، وعدد الطلاب "في خطر" أو "منقطعين".
//
// النشر:
//   supabase functions deploy weekly-report

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (WEBHOOK_SECRET) {
    const secret = req.headers.get('x-webhook-secret');
    if (secret !== WEBHOOK_SECRET) {
      return jsonResponse({ error: 'مفيش تفويض' }, 401);
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgoDate = weekAgo.slice(0, 10);

  const [
    { count: newStudents },
    { count: newReports },
    { count: newThreads },
    { count: newReplies },
    { data: weeklyUsage },
  ] = await Promise.all([
    admin.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student').gte('created_at', weekAgo),
    admin.from('forum_reports').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('forum_threads').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('forum_replies').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
    admin.from('ai_usage_daily').select('user_id, message_count').gte('usage_date', sevenDaysAgoDate).lte('usage_date', today),
  ]);

  // أكتر طالب استخدامًا للـ AI الأسبوع ده
  const totalsByUser = new Map<string, number>();
  for (const row of weeklyUsage ?? []) {
    totalsByUser.set(row.user_id, (totalsByUser.get(row.user_id) ?? 0) + (row.message_count ?? 0));
  }
  const topEntry = [...totalsByUser.entries()].sort((a, b) => b[1] - a[1])[0];
  let topStudentLine = 'مفيش استخدام مسجّل';
  if (topEntry) {
    const { data: topProfile } = await admin.from('profiles').select('name').eq('id', topEntry[0]).maybeSingle();
    topStudentLine = `${topProfile?.name ?? 'طالب'} (${topEntry[1]} رسالة)`;
  }

  const text = `📊 التقرير الأسبوعي — طالب علم

👥 طلاب جدد: ${newStudents ?? 0}
💬 مواضيع جديدة: ${newThreads ?? 0} | ردود: ${newReplies ?? 0}
🚩 بلاغات الأسبوع: ${newReports ?? 0}
🤖 أكتر طالب استخدامًا للـ AI: ${topStudentLine}`;

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
  }

  return jsonResponse({ ok: true, text });
});
