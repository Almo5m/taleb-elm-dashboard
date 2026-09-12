// supabase/functions/classify-ai-questions/index.ts
//
// بتتنادى مرة يوميًا (شوف supabase_backend_improvements_v2.sql) من
// pg_cron. بتاخد لحد 50 سؤال متصنّفش لسه من ai_chat_logs، وتبعتهم كلهم في
// طلب Gemini واحد بس (مش طلب لكل سؤال) عشان توفّر في استهلاك الـ API —
// وترجّع تصنيف لكل واحد فيهم.
//
// النشر:
//   supabase functions deploy classify-ai-questions
//
// (بتستخدم نفس GEMINI_API_KEY و WEBHOOK_SECRET المتاحين أصلاً كـ secrets
//  على مستوى المشروع، مش محتاجة أسرار إضافية)

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');

const CATEGORIES = ['منهج', 'التطبيق', 'دعم', 'خارج النطاق'] as const;

const CLASSIFY_PROMPT = `
انت هتصنّف كل سؤال من الأسئلة التالية لطلاب ثانوي بعتوها لمساعد ذكي، إلى
واحدة من التصنيفات دي بالظبط (كلمة واحدة من غير أي شرح):
- "منهج": سؤال دراسي حقيقي عن مادة (حل مسألة، شرح مفهوم، مراجعة)
- "التطبيق": سؤال عن استخدام التطبيق نفسه أو ميزة فيه
- "دعم": تحفيز، تنظيم وقت، قلق امتحانات، دعم نفسي/دراسي عام
- "خارج النطاق": أي حاجة تانية مش من دول

رجّع النتيجة كـ JSON array بس من غير أي نص زيادة، بالشكل ده بالظبط:
[{"id": "...", "category": "..."}]

الأسئلة:
`;

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

  const { data: rows, error } = await admin
    .from('ai_chat_logs')
    .select('id, question')
    .is('category', null)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('fetch unclassified error:', error);
    return jsonResponse({ error: error.message }, 500);
  }

  if (!rows || rows.length === 0) {
    return jsonResponse({ ok: true, classified: 0 });
  }

  const promptBody = rows.map((r) => `- id: ${r.id} | السؤال: ${r.question}`).join('\n');

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: CLASSIFY_PROMPT + promptBody }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 2048 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini classify error:', geminiRes.status, errText);
      return jsonResponse({ error: 'فشل التصنيف' }, 502);
    }

    const geminiData = await geminiRes.json();
    const rawText: string =
      geminiData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';

    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const results: { id: string; category: string }[] = JSON.parse(cleaned);

    let classified = 0;
    for (const r of results) {
      const category = CATEGORIES.includes(r.category as any) ? r.category : 'خارج النطاق';
      const { error: updateError } = await admin.from('ai_chat_logs').update({ category }).eq('id', r.id);
      if (!updateError) classified += 1;
    }

    return jsonResponse({ ok: true, classified, total: rows.length });
  } catch (e) {
    console.error('classify-ai-questions error:', e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
