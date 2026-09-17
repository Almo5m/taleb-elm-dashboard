import { Hono } from 'hono';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  OAUTH_PROVIDER: OAuthHelpers;
}

const app = new Hono<{ Bindings: Env }>();

// escaping بسيط عشان أي نص بيتحقن جوه الـ HTML متبقاش قادرة تكسر الصفحة أو
// تحقن سكريبت — errorMessage دلوقتي نصوص ثابتة من عندي بس، لكن الأفضل نمنع
// النمط الخطر من الأساس بدل ما نعتمد على إننا "متأكدين" من مصدره
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loginPage(oauthRequestToken: string, errorMessage?: string) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>تسجيل الدخول — طالب علم</title>
  <style>
    body { font-family: Tajawal, Cairo, sans-serif; background: #132019; color: #fff;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    form { background: #1c2c22; padding: 32px; border-radius: 16px; width: 320px; }
    h1 { font-size: 18px; margin: 0 0 20px; color: #E3A72E; }
    label { display: block; margin-bottom: 6px; font-size: 14px; }
    input { width: 100%; padding: 10px; margin-bottom: 16px; border-radius: 8px;
            border: 1px solid #2f4636; background: #132019; color: #fff; box-sizing: border-box; }
    button { width: 100%; padding: 10px; border-radius: 8px; border: none;
             background: #E3A72E; color: #132019; font-weight: bold; cursor: pointer; }
    .error { color: #ff8a8a; font-size: 13px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <form method="POST">
    <h1>الدخول للوحة تحكم طالب علم — MCP</h1>
    ${errorMessage ? `<div class="error">${escapeHtml(errorMessage)}</div>` : ''}
    <input type="hidden" name="oauth_request" value="${escapeHtml(oauthRequestToken)}" />
    <label>البريد الإلكتروني</label>
    <input type="email" name="email" required autofocus />
    <label>كلمة المرور</label>
    <input type="password" name="password" required />
    <button type="submit">دخول</button>
  </form>
</body>
</html>`;
}

app.get('/authorize', async (c) => {
  const oauthRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const encoded = btoa(JSON.stringify(oauthRequest));
  return c.html(loginPage(encoded));
});

app.post('/authorize', async (c) => {
  const body = await c.req.parseBody();

  let oauthRequest: any;
  try {
    oauthRequest = JSON.parse(atob(String(body.oauth_request)));
  } catch {
    return c.html(
      `<p style="font-family:sans-serif">الجلسة دي قديمة أو غير صالحة. اقفل التبويب ده وابدأ عملية ربط الاتصال من جديد من تطبيق Claude.</p>`,
      400
    );
  }

  if (!oauthRequest?.redirectUri) {
    return c.html(
      `<p style="font-family:sans-serif">طلب الدخول ده ناقصه بيانات أساسية (redirect_uri). اقفل التبويب ده وابدأ عملية ربط الاتصال من جديد من تطبيق Claude بدل ما ترجع لصفحة قديمة.</p>`,
      400
    );
  }

  const email = String(body.email || '');
  const password = String(body.password || '');

  const authResponse = await fetch(`${c.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: c.env.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!authResponse.ok) {
    const errorBody = await authResponse.text();
    console.log('Supabase auth failed:', authResponse.status, errorBody);
    return c.html(loginPage(btoa(JSON.stringify(oauthRequest)), 'البريد الإلكتروني أو كلمة المرور غلط'));
  }

  const authData = await authResponse.json<{ access_token: string; user: { id: string; email: string } }>();

  const profileResponse = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/profiles?id=eq.${authData.user.id}&select=role`,
    {
      headers: {
        apikey: c.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${authData.access_token}`,
      },
    }
  );
  const profileRows = await profileResponse.json<{ role: string }[]>();

  if (profileRows?.[0]?.role !== 'admin') {
    return c.html(loginPage(btoa(JSON.stringify(oauthRequest)), 'الحساب ده مش أدمن كامل، مش مسموح له بالدخول هنا'));
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthRequest,
    userId: authData.user.id,
    metadata: { email: authData.user.email },
    scope: oauthRequest.scope,
    props: {
      adminId: authData.user.id,
      adminEmail: authData.user.email,
    },
  });

  return Response.redirect(redirectTo);
});

export default app;
