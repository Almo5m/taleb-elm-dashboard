// ============================================
// طالب علم — Edge Function: send-push-notification
// ============================================
// النقطة الوحيدة اللي فيها بيانات حساب خدمة Firebase (Service Account) —
// لوحة التحكم بتنادي الدالة دي بس، مش بتكلم FCM مباشرة أبدًا، عشان مفتاح
// الحساب الخاص مايتحطش في كود React (قابل للاستخراج من أي حد يفتح الموقع).
//
// الاستخدام من لوحة التحكم: POST بـ body:
//   { "title": "...", "body": "...", "target_type": "all" }
//   أو
//   { "title": "...", "body": "...", "target_type": "single_user", "target_user_id": "uuid" }
//
// ⚠️ بعد أي تعديل هنا لازم:
//   supabase functions deploy send-push-notification
//
// الأسرار المطلوبة (مرة واحدة بس، عن طريق supabase secrets set):
//   FCM_SERVICE_ACCOUNT_JSON = محتوى ملف service-account.json كامل (سطر واحد)
//   (SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY متاحين تلقائيًا)
//
// طريقة الحصول على service-account.json:
//   Firebase Console → Project Settings → Service Accounts → Generate new private key
// ============================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')!;

// نفس نمط الـ CORS في باقي فنكشنز المشروع (admin-ai-usage، ai-assistant...) —
// من غيرها المتصفح بيرفض الطلب من اللوحة (Vercel) من الأساس قبل ما يوصل
// لأي منطق جوه الفنكشن
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ---------------- توليد OAuth2 access token من بيانات حساب الخدمة ----------------

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(): Promise<string> {
  const serviceAccount = JSON.parse(FCM_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const claimsB64 = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const unsigned = `${headerB64}.${claimsB64}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`فشل الحصول على access token: ${errText}`);
  }
  const tokenData = await tokenRes.json();
  return tokenData.access_token as string;
}

// ---------------- إرسال لتوكن واحد ----------------

async function sendToToken(projectId: string, accessToken: string, token: string, title: string, body: string): Promise<boolean> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message: { token, notification: { title, body } } }),
  });
  return res.ok;
}

// ---------------- المعالج الرئيسي ----------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // نتأكد إن اللي بيبعت الطلب أدمن فعلي — مش أي مستخدم عادي في التطبيق.
  // بيستخدم نفس نمط is_admin()/role الموجود في supabase_admin.sql
  const jwt = authHeader.replace('Bearer ', '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  const { data: profile } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle();
  if (profile?.role !== 'admin') {
    return jsonResponse({ error: 'forbidden — أدمن بس' }, 403);
  }

  let payload: { title?: string; body?: string; target_type?: string; target_user_id?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid body' }, 400);
  }

  const title = payload.title?.trim();
  const body = payload.body?.trim();
  const targetType = payload.target_type;
  if (!title || !body || (targetType !== 'all' && targetType !== 'single_user')) {
    return jsonResponse({ error: 'بيانات ناقصة أو غلط' }, 400);
  }
  if (targetType === 'single_user' && !payload.target_user_id) {
    return jsonResponse({ error: 'محتاج target_user_id' }, 400);
  }

  // بنسجّل محاولة الإرسال في اللوج الأول (status: pending) عشان يبان في
  // اللوحة حتى لو حصل خطأ في النص اللي جاي
  const { data: logRow } = await admin
    .from('push_notifications_log')
    .insert({ title, body, target_type: targetType, target_user_id: payload.target_user_id ?? null, status: 'pending' })
    .select()
    .single();

  try {
    const serviceAccount = JSON.parse(FCM_SERVICE_ACCOUNT_JSON);
    const projectId = serviceAccount.project_id as string;
    const accessToken = await getAccessToken();

    let tokensQuery = admin.from('device_tokens').select('token, user_id');
    if (targetType === 'single_user') {
      tokensQuery = tokensQuery.eq('user_id', payload.target_user_id);
    }
    const { data: tokenRows, error: tokensError } = await tokensQuery;
    if (tokensError) throw tokensError;

    if (!tokenRows || tokenRows.length === 0) {
      await admin.from('push_notifications_log').update({ status: 'failed', error_message: 'مفيش أي جهاز مسجّل للمستهدفين' }).eq('id', logRow.id);
      return jsonResponse({ error: 'مفيش أي جهاز مسجّل للمستهدفين' }, 200);
    }

    let successCount = 0;
    const invalidTokens: string[] = [];
    for (const row of tokenRows) {
      const ok = await sendToToken(projectId, accessToken, row.token, title, body);
      if (ok) {
        successCount++;
      } else {
        invalidTokens.push(row.token);
      }
    }

    // توكنز فشلت (على الأغلب الطالب مسح التطبيق أو التوكن قديم) — بنشيلها
    // عشان المحاولات الجاية متضيعش وقت عليها
    if (invalidTokens.length > 0) {
      await admin.from('device_tokens').delete().in('token', invalidTokens);
    }

    await admin
      .from('push_notifications_log')
      .update({
        status: successCount > 0 ? 'sent' : 'failed',
        error_message: successCount > 0 ? null : 'فشل الإرسال لكل الأجهزة المستهدفة',
      })
      .eq('id', logRow.id);

    return jsonResponse({ sent: successCount, failed: invalidTokens.length, total: tokenRows.length });
  } catch (e) {
    console.error('send-push-notification error:', e);
    await admin.from('push_notifications_log').update({ status: 'failed', error_message: String(e) }).eq('id', logRow.id);
    return jsonResponse({ error: 'حصل خطأ أثناء الإرسال' }, 502);
  }
});
