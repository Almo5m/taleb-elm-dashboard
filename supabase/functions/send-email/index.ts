// ============================================
// طالب علم — Edge Function: send-email
// ============================================
// النقطة الوحيدة اللي فيها مفتاح Resend. بتشتغل في وضعين حسب مين اللي بينادي:
//
// 1) من لوحة التحكم (Authorization: Bearer <توكن أدمن>):
//    { subject, body, target_type: 'all'|'grade'|'single_user',
//      target_grade?, target_user_id?, scheduled_at? }
//    لو scheduled_at فاضي أو في الماضي → بيبعت فورًا.
//    لو scheduled_at في المستقبل → بيسجّل الصف بس بحالة "pending" ويرجع،
//    والإرسال الفعلي بيحصل بعدين من نفس الفنكشن (وضع 2).
//
// 2) من pg_cron كل 5 دقايق (x-webhook-secret، مفيش Authorization أدمن):
//    { mode: "process_due" } — بتدوّر على أي صف "pending" وقته استحق
//    (scheduled_at <= الآن) وتبعته.
//
// ⚠️ خصوصية مهمة: بنبعت إيميل منفصل لكل طالب (مش To/CC فيها كل الإيميلات
// مع بعض) — عشان إيميل أي طالب ميظهرش لطالب تاني.
//
// ⚠️ حد الخطة المجانية في Resend: 100 إيميل/يوم، 3000/شهر. لو العدد
// المستهدف كبير، ممكن يفشل جزء منهم لو الحد اتخطى.
//
// النشر: supabase functions deploy send-email
// الأسرار المطلوبة:
//   supabase secrets set RESEND_API_KEY=...
//   supabase secrets set RESEND_FROM_EMAIL="طالب علم <no-reply@yourdomain.com>"
// (WEBHOOK_SECRET مشترك أصلًا من الميزات التانية في المشروع)
// ============================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev';
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sendOne(to: string, subject: string, html: string): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    console.error('Resend send failed:', res.status, await res.text());
  }
  return res.ok;
}

async function resolveRecipients(
  admin: ReturnType<typeof createClient>,
  targetType: string,
  targetGrade: string | null,
  targetUserId: string | null
): Promise<string[]> {
  let query = admin.from('profiles').select('email').eq('role', 'student').not('email', 'is', null);
  if (targetType === 'grade') query = query.eq('grade', targetGrade);
  if (targetType === 'single_user') query = query.eq('id', targetUserId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => r.email).filter(Boolean);
}

async function processRow(admin: ReturnType<typeof createClient>, row: any) {
  try {
    const recipients = await resolveRecipients(admin, row.target_type, row.target_grade, row.target_user_id);

    if (recipients.length === 0) {
      await admin
        .from('scheduled_emails')
        .update({ status: 'failed', error_message: 'مفيش أي مستلم مطابق' })
        .eq('id', row.id);
      return;
    }

    let sent = 0;
    for (const email of recipients) {
      const ok = await sendOne(email, row.subject, row.body);
      if (ok) sent++;
    }

    await admin
      .from('scheduled_emails')
      .update({
        status: sent > 0 ? 'sent' : 'failed',
        sent_count: sent,
        failed_count: recipients.length - sent,
        error_message: sent === 0 ? 'فشل الإرسال لكل المستلمين' : null,
      })
      .eq('id', row.id);
  } catch (e) {
    console.error('processRow error:', e);
    await admin
      .from('scheduled_emails')
      .update({ status: 'failed', error_message: String(e) })
      .eq('id', row.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }

  // ---------- وضع المعالجة الدورية (من pg_cron) ----------
  if (payload.mode === 'process_due') {
    const secret = req.headers.get('x-webhook-secret');
    if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
      return jsonResponse({ error: 'مفيش تفويض' }, 401);
    }

    const { data: dueRows, error } = await admin
      .from('scheduled_emails')
      .select('*')
      .eq('status', 'pending')
      .not('scheduled_at', 'is', null)
      .lte('scheduled_at', new Date().toISOString())
      .limit(20);

    if (error) return jsonResponse({ error: error.message }, 500);

    for (const row of dueRows ?? []) {
      await processRow(admin, row);
    }
    return jsonResponse({ ok: true, processed: dueRows?.length ?? 0 });
  }

  // ---------- وضع الإرسال من لوحة التحكم (أدمن) ----------
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'unauthorized' }, 401);

  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401);

  const { data: profile } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
  if (profile?.role !== 'admin') return jsonResponse({ error: 'forbidden — أدمن بس' }, 403);

  const { subject, body, target_type, target_grade, target_user_id, scheduled_at } = payload;

  if (!subject?.trim() || !body?.trim() || !['all', 'grade', 'single_user'].includes(target_type)) {
    return jsonResponse({ error: 'بيانات ناقصة أو غلط' }, 400);
  }
  if (target_type === 'grade' && !target_grade) {
    return jsonResponse({ error: 'محتاج target_grade' }, 400);
  }
  if (target_type === 'single_user' && !target_user_id) {
    return jsonResponse({ error: 'محتاج target_user_id' }, 400);
  }

  const isFuture = scheduled_at && new Date(scheduled_at).getTime() > Date.now() + 60_000;

  const { data: logRow, error: insertError } = await admin
    .from('scheduled_emails')
    .insert({
      subject: subject.trim(),
      body: body.trim(),
      target_type,
      target_grade: target_type === 'grade' ? target_grade : null,
      target_user_id: target_type === 'single_user' ? target_user_id : null,
      scheduled_at: isFuture ? scheduled_at : null,
      status: 'pending',
    })
    .select()
    .single();

  if (insertError) return jsonResponse({ error: insertError.message }, 500);

  if (isFuture) {
    return jsonResponse({ scheduled: true, scheduled_at });
  }

  // إرسال فوري
  try {
    const recipients = await resolveRecipients(admin, target_type, target_grade ?? null, target_user_id ?? null);
    if (recipients.length === 0) {
      await admin.from('scheduled_emails').update({ status: 'failed', error_message: 'مفيش أي مستلم مطابق' }).eq('id', logRow.id);
      return jsonResponse({ error: 'مفيش أي مستلم مطابق' }, 200);
    }

    let sent = 0;
    for (const email of recipients) {
      const ok = await sendOne(email, subject.trim(), body.trim());
      if (ok) sent++;
    }

    await admin
      .from('scheduled_emails')
      .update({
        status: sent > 0 ? 'sent' : 'failed',
        sent_count: sent,
        failed_count: recipients.length - sent,
        error_message: sent === 0 ? 'فشل الإرسال لكل المستلمين' : null,
      })
      .eq('id', logRow.id);

    return jsonResponse({ sent, failed: recipients.length - sent, total: recipients.length });
  } catch (e) {
    console.error('send-email error:', e);
    await admin.from('scheduled_emails').update({ status: 'failed', error_message: String(e) }).eq('id', logRow.id);
    return jsonResponse({ error: 'حصل خطأ أثناء الإرسال' }, 502);
  }
});
