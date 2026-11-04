import { supabase } from '../supabaseClient';

export async function writeSetting(key, value) {
  return supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
}

/**
 * قراءة مفتاح من app_settings مع التفرقة بين "مفيش صف" و"فشلت القراءة".
 * مهم للصفحات اللي بتستبدل قيمة كاملة: لو القراءة فشلت مينفعش نعتبرها فاضية
 * ونكتب فوق قيمة موجودة.
 */
export async function fetchSetting(key) {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (error) return { error, value: null, exists: false };
  return { error: null, value: data?.value ?? null, exists: !!data };
}
