# اختبارات Edge Function: ai-assistant

بتجرّب المنطق الصافي (`ai-core.ts`) والدالة كاملة (`index.ts`) من الطلب لحد الرد، من غير شبكة:
Supabase بديل في الذاكرة (`supabase_stub.ts`) و Gemini وتليجرام مزيّفين. أخطاء جوجل في `fixtures/` منسوخة من سجل الإنتاج الحقيقي.

التشغيل (محتاج Deno):

```
deno test --no-lock --allow-read --allow-env --import-map=tests/edge/import_map.json tests/edge/
```

لو غيّرت `index.ts` أو `ai-core.ts`: شغّل الاختبارات، وبعدين انشر `supabase functions deploy ai-assistant`.
