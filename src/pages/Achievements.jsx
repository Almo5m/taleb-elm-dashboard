import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, EmptyState, useToast, useConfirm } from '../components/UI';

const METRICS = [
  { value: 'study_hours', label: 'ساعات المذاكرة' },
  { value: 'tasks', label: 'المهام المنجزة' },
  { value: 'sessions', label: 'جلسات المذاكرة' },
  { value: 'streak', label: 'أيام متتالية' },
  { value: 'subjects_completed', label: 'مواد مكتملة' },
];

export default function Achievements() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', description: '', metric: 'study_hours', threshold: '' });
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('achievements_catalog').select('*').order('threshold');
    if (error) toast('تعذّر تحميل الإنجازات', 'error', error);
    setItems(data || []);
    setLoading(false);
  };

  const add = async () => {
    if (!form.title.trim() || !form.threshold) return;
    const { error } = await supabase.from('achievements_catalog').insert({
      title: form.title.trim(),
      description: form.description.trim() || form.title.trim(),
      metric: form.metric,
      threshold: Number(form.threshold),
    });
    if (error) { toast('تعذّر إضافة الإنجاز', 'error', error); return; }
    setForm({ title: '', description: '', metric: 'study_hours', threshold: '' });
    toast('تمت إضافة الإنجاز');
    load();
  };

  const remove = async (id) => {
    const ok = await confirm('هتحذف الإنجاز ده من الكتالوج، متأكد؟', { danger: true, confirmLabel: 'حذف' });
    if (!ok) return;
    const { error } = await supabase.from('achievements_catalog').delete().eq('id', id);
    if (error) { toast('تعذّر حذف الإنجاز', 'error', error); return; }
    setItems((prev) => prev.filter((i) => i.id !== id));
    toast('تم حذف الإنجاز');
  };

  return (
    <div>
      <PageHeader eyebrow={`${items.length} إنجاز في الكتالوج`} title="الإنجازات" />

      <div className="card p-5 mb-8 max-w-2xl">
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="اسم الإنجاز *"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="input-field"
          />
          <input
            placeholder="وصف قصير"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="input-field"
          />
          <select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} className="input-field">
            {METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input
            type="number"
            placeholder="الرقم المطلوب للفتح *"
            value={form.threshold}
            onChange={(e) => setForm({ ...form, threshold: e.target.value })}
            className="input-field"
          />
        </div>
        <button onClick={add} className="btn-primary mt-3">إضافة الإنجاز</button>
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="★" title="مفيش إنجازات في الكتالوج لسه" />
      ) : (
        <div className="space-y-2 max-w-2xl">
          {items.map((i) => (
            <div key={i.id} className="card p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{i.title}</p>
                <p className="text-xs text-muted">{METRICS.find((m) => m.value === i.metric)?.label} ≥ {i.threshold}</p>
              </div>
              <button onClick={() => remove(i.id)} className="text-xs font-semibold text-muted hover:text-coral px-3 py-1.5 shrink-0">حذف</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
