// Supabase بيرجّع 1000 صف بس في الطلب الواحد (الحد الافتراضي للـ API)، وبيقطع الباقي من غير أي خطأ.
// الدالة دي بتجيب كل الصفوف على دفعات. لازم الاستعلام يكون مترتّب بعمود ثابت (والأفضل عمود فريد)
// عشان الدفعات ماتكرّرش صف ولا تفوّت صف.
//
// الاستخدام:
//   const { data, error } = await fetchAll(() => supabase.from('profiles').select('*').order('id'));
export async function fetchAll(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: rows, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { data: rows, error: null };
}

// تنفيذ عملية على قايمة IDs كبيرة على دفعات. استعلامات .in('id', [...]) بتحط الـ IDs في رابط الطلب،
// ولو الرابط طال (مئات الـ IDs) السيرفر بيرفضه. بنوقف عند أول خطأ وبنرجّع كام واحد اتنفّذ.
//
//   const { error, done } = await inChunks(ids, (part) => supabase.from('t').delete().in('id', part));
export async function inChunks(ids, run, size = 100) {
  for (let i = 0; i < ids.length; i += size) {
    const { error } = await run(ids.slice(i, i + size));
    if (error) return { error, done: i };
  }
  return { error: null, done: ids.length };
}
