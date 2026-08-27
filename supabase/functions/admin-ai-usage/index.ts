// supabase/functions/admin-ai-usage/index.ts
//
// جدولي ai_usage_daily و ai_usage_monthly عليهم RLS من غير أي policies،
// فمفتاح anon اللي لوحة التحكم React بتستخدمه مايقدرش يقراهم خالص. الدالة دي
// بتتحقق إن الطالب اللي بعت الطلب أدمن فعلاً، وبعدين تقرا صف الشهر الحالي
// بمفتاح service_role اللي بيتجاوز RLS.
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

    return new Response(
      JSON.stringify({ month, message_count: usageRow?.message_count ?? 0 }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});