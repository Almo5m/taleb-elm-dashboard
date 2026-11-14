// supabase/functions/client-errors-alert/index.ts
//
// بتتنادى من pg_cron كل 30 دقيقة (شوف sql/supabase_client_errors_alert.sql).
// لو عدد تقارير الأعطال في آخر 30 دقيقة وصل للحد (THRESHOLD)، بتبعت رسالة
// تليجرام واحدة فيها أكتر الرسايل تكرارًا. وكمان (alertRealBugs) تنبيه للباجات الحقيقية الجديدة
// (3 أجهزة أو أكتر) والأعطال اللي رجعت بعد الإصلاح. عمدًا مفيش تنبيه لكل صف: الجدول
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

// ===== تنبيه الباجات الحقيقية (من views sql/supabase_client_errors_v2.sql) =====
// بيبعت تنبيه تليجرام لما:
//   - باج (kind = bug) مفتوح ظهر على 3 أجهزة مختلفة أو أكتر وهو لسه ظاهر في آخر ساعتين.
//   - عطل اتعلّم "اتصلح" رجع تاني (regressed): مرة لكل إصدار اتعلّم فيه إنه اتصلح.
// كل عطل بيتنبّه عليه مرة واحدة بس (جدول client_error_alerts، شوف sql/supabase_client_error_alerts.sql).
// لو الـ views أو الجدول لسه ماتعملوش، بيتخطّى من غير أي خطأ.
const NEW_BUG_DEVICES = 3;
const ACTIVE_WITHIN_MS = 2 * 60 * 60 * 1000;
const MAX_LISTED = 5;

type GroupRow = {
  signature: string;
  kind: string;
  status: string;
  devices: number;
  reports: number;
  versions: string[] | null;
  sample_message: string | null;
  top_frame: string | null;
  fixed_in_version: string | null;
  regressed: boolean;
  last_seen: string;
};

async function alertRealBugs(admin: ReturnType<typeof createClient>): Promise<{ sent: number }> {
  try {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return { sent: 0 };

    const { data, error } = await admin
      .from('client_error_groups')
      .select('signature, kind, status, devices, reports, versions, sample_message, top_frame, fixed_in_version, regressed, last_seen')
      .eq('kind', 'bug')
      .neq('status', 'ignored')
      .order('devices', { ascending: false })
      .limit(200);
    if (error) {
      console.error('client_error_groups skipped:', error.message);
      return { sent: 0 };
    }

    const activeSince = Date.now() - ACTIVE_WITHIN_MS;
    const candidates = ((data ?? []) as GroupRow[])
      .filter((g) => g.kind === 'bug' && g.status !== 'ignored' && new Date(g.last_seen).getTime() >= activeSince)
      .map((g) => {
        if (g.regressed) return { g, alert_kind: 'regressed', ref: g.fixed_in_version ?? '' };
        if (g.status === 'open' && g.devices >= NEW_BUG_DEVICES) return { g, alert_kind: 'new', ref: '' };
        return null;
      })
      .filter((c): c is { g: GroupRow; alert_kind: string; ref: string } => c !== null);
    if (candidates.length === 0) return { sent: 0 };

    // upsert مع ignoreDuplicates بيرجّع الصفوف الجديدة بس (اللي ماتنبّهش عليها قبل كده)
    const { data: inserted, error: insertError } = await admin
      .from('client_error_alerts')
      .upsert(
        candidates.map((c) => ({ signature: c.g.signature, alert_kind: c.alert_kind, ref: c.ref, devices: c.g.devices })),
        { onConflict: 'signature,alert_kind,ref', ignoreDuplicates: true },
      )
      .select('signature, alert_kind, ref');
    if (insertError) {
      console.error('client_error_alerts skipped:', insertError.message);
      return { sent: 0 };
    }

    const fresh = candidates.filter((c) =>
      (inserted ?? []).some((r: { signature: string; alert_kind: string; ref: string }) =>
        r.signature === c.g.signature && r.alert_kind === c.alert_kind && r.ref === c.ref)
    );
    if (fresh.length === 0) return { sent: 0 };

    const lines = fresh.slice(0, MAX_LISTED).map((c, i) => {
      const g = c.g;
      const title = c.alert_kind === 'regressed' ? '↺ رجع تاني بعد الإصلاح' : '🐞 باج جديد';
      const where = g.top_frame ? `\n   <code>${escapeHtml(g.top_frame)}</code>` : '';
      return `${i + 1}. ${title}\n   <code>${escapeHtml((g.sample_message ?? '(بدون رسالة)').slice(0, 120))}</code>${where}\n` +
        `   ${g.devices} جهاز · ${g.reports} تقرير · ${escapeHtml((g.versions ?? []).join('، ') || '—')}`;
    });
    const more = fresh.length > MAX_LISTED ? `\n\nو ${fresh.length - MAX_LISTED} أعطال تانية، افتح صفحة أعطال التطبيق.` : '';
    const text = `⚠️ <b>أعطال حقيقية في التطبيق</b>\n\n${lines.join('\n\n')}${more}`;

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) console.error('Telegram send failed:', res.status, await res.text());
    return { sent: fresh.length };
  } catch (e) {
    console.error('alertRealBugs error:', e);
    return { sent: 0 };
  }
}

Deno.serve(async (req) => {
  // الفنكشن دي بتتنادى من pg_cron بس، فالسر إلزامي (مفيش مسار بدون سر)
  const secret = req.headers.get('x-webhook-secret');
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return jsonResponse({ error: 'مفيش تفويض' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const bugAlerts = await alertRealBugs(admin);
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
    return jsonResponse({ ok: true, alerted: false, count: rows.length, bugAlerts: bugAlerts.sent });
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

  return jsonResponse({ ok: true, alerted: true, count: rows.length, bugAlerts: bugAlerts.sent });
});
