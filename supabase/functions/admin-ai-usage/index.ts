// supabase/functions/admin-ai-usage/index.ts
//
// جدولي ai_usage_daily و ai_usage_monthly عليهم RLS من غير أي policies،
// فمفتاح anon اللي لوحة التحكم React بتستخدمه مايقدرش يقراهم خالص. الدالة دي
// بتتحقق إن الطالب اللي بعت الطلب أدمن فعلاً، وبعدين تقرا صف الشهر الحالي
// بمفتاح service_role اللي بيتجاوز RLS.
//
// (نسخة محدّثة): لو الطلب فيه body.user_id، بترجع كمان استهلاك النهاردة
// واستهلاك الشهر الحالي بتاع الطالب ده تحديدًا (لصفحة الملف الشخصي في
// اللوحة). لو الطلب فيه body.leaderboard=true، بترجع أكتر 10 طلاب استخدامًا
// للـ AI في الشهر الحالي — من غير ما تكسر أي كود قديم بينادي الدالة عادي.
//
// النشر:
//   1) لازم Supabase CLI: https://supabase.com/docs/guides/cli
//   2) supabase login
//   3) supabase link --project-ref <project-ref-بتاعك>
//   4) supabase functions deploy admin-ai-usage
//
// (مفتاح service_role موجود بالفعل تلقائيًا كـ SUPABASE_SERVICE_ROLE_KEY
//  جوه بيئة الـ Edge Function، مش محتاج تضيفه يدوي)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function currentMonthKey() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function currentMonthRange() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'مفيش تفويض' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // عميل بصلاحيات المستخدم اللي بعت الطلب — نستخدمه بس عشان نتأكد إنه أدمن فعلاً
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_ANON_KEY'),
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: 'مش متسجل دخول' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: callerProfile } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single();

    if (callerProfile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'الإجراء ده للأدمن الكامل بس' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // body اختياري — لو فيه user_id بنرجع كمان استهلاك النهاردة/الشهر بتاع
    // الطالب ده، ولو فيه leaderboard=true بنرجع أكتر الطلاب استخدامًا
    let body: { user_id?: string; leaderboard?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const targetUserId = body?.user_id;

    // عميل بصلاحيات service_role — هو الوحيد اللي يقدر يقرا جداول الاستهلاك
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    const month = currentMonthKey();
    const { data: usageRow, error: usageError } = await adminClient
      .from('ai_usage_monthly')
      .select('message_count')
      .eq('month', month)
      .maybeSingle();

    if (usageError) {
      return new Response(JSON.stringify({ error: usageError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let student = null;
    if (targetUserId) {
      const today = todayKey();
      const { start, end } = currentMonthRange();
      const [{ data: dailyRow }, { data: monthRows }, { data: accessRow }, { data: settingsRow }] = await Promise.all([
        adminClient.from('ai_usage_daily').select('message_count').eq('user_id', targetUserId).eq('usage_date', today).maybeSingle(),
        adminClient.from('ai_usage_daily').select('message_count').eq('user_id', targetUserId).gte('usage_date', start).lte('usage_date', end),
        adminClient.from('ai_access').select('daily_limit_override').eq('user_id', targetUserId).maybeSingle(),
        adminClient.from('app_settings').select('value').eq('key', 'ai_assistant').maybeSingle(),
      ]);
      const globalDefault = settingsRow?.value?.daily_limit_per_user ?? 20;
      const monthlyTotal = (monthRows ?? []).reduce((sum, row) => sum + (row.message_count ?? 0), 0);
      student = {
        usage_date: today,
        today_count: dailyRow?.message_count ?? 0,
        month_count: monthlyTotal,
        daily_limit: accessRow?.daily_limit_override ?? globalDefault,
      };
    }

    let leaderboard = null;
    if (body?.leaderboard) {
      const { start, end } = currentMonthRange();
      const { data: rows, error: leaderboardError } = await adminClient
        .from('ai_usage_daily')
        .select('user_id, message_count')
        .gte('usage_date', start)
        .lte('usage_date', end);

      if (leaderboardError) {
        return new Response(JSON.stringify({ error: leaderboardError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const totalsByUser = new Map<string, number>();
      for (const row of rows ?? []) {
        totalsByUser.set(row.user_id, (totalsByUser.get(row.user_id) ?? 0) + (row.message_count ?? 0));
      }

      const topUserIds = [...totalsByUser.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([userId]) => userId);

      const { data: profileRows } = await adminClient
        .from('profiles')
        .select('id, full_name, email')
        .in('id', topUserIds.length ? topUserIds : ['00000000-0000-0000-0000-000000000000']);

      const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]));
      leaderboard = topUserIds.map((userId) => ({
        user_id: userId,
        full_name: profileById.get(userId)?.full_name ?? '—',
        email: profileById.get(userId)?.email ?? '—',
        message_count: totalsByUser.get(userId) ?? 0,
      }));
    }

    return new Response(
      JSON.stringify({ month, message_count: usageRow?.message_count ?? 0, student, leaderboard }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

