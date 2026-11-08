import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, EmptyState, useToast, useConfirm } from '../components/UI';

const GRADES = ['', 'الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];
const SYSTEMS = ['', 'الثانوية العامة', 'البكالوريا المصرية'];

export default function StudyPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ subject_name: '', title: '', description: '', target_system: '', target_grade: '' });
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('study_plan_tasks').select('*').order('created_at', { ascending: false });
    if (error) toast('تعذّر تحميل الخطط', 'error', error);
    setPlans(data || []);
    setLoading(false);
  };

  const add = async () => {
    if (!form.subject_name.trim() || !form.title.trim()) return;
    const { error } = await supabase.from('study_plan_tasks').insert({
      subject_name: form.subject_name.trim(),
      title: form.title.trim(),
      description: form.description.trim() || null,
      target_system: form.target_system || null,
      target_grade: form.target_grade || null,
    });
    if (error) { toast('تعذّر إضافة المهمة', 'error', error); return; }
    setForm({ subject_name: '', title: '', description: '', target_system: '', target_grade: '' });
    toast('تمت إضافة المهمة');
    load();
  };

  const remove = async (id) => {
    const ok = await confirm('هتحذف المهمة دي من الخطط الجاهزة، متأكد؟', { danger: true, confirmLabel: 'حذف' });
    if (!ok) return;
    const { error } = await supabase.from('study_plan_tasks').delete().eq('id', id);
    if (error) { toast('تعذّر حذف المهمة', 'error', error); return; }
    setPlans((prev) => prev.filter((p) => p.id !== id));
    toast('تم حذف المهمة');
  };

  return (
    <div>
      <PageHeader eyebrow={`${plans.length} مهمة جاهزة`} title="خطط مذاكرة" />

      <div className="card p-5 mb-8 max-w-2xl">
        <p className="text-sm text-muted mb-4">أضف مهمة جاهزة لمادة معينة، وأي طالب يقدر يضيفها لخطته لو حب</p>
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="اسم المادة *"
            value={form.subject_name}
            onChange={(e) => setForm({ ...form, subject_name: e.target.value })}
            className="input-field"
          />
          <input
            placeholder="عنوان المهمة *"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="input-field"
          />
          <select value={form.target_system} onChange={(e) => setForm({ ...form, target_system: e.target.value })} className="input-field">
            {SYSTEMS.map((s) => <option key={s} value={s}>{s || 'كل الأنظمة'}</option>)}
          </select>
          <select value={form.target_grade} onChange={(e) => setForm({ ...form, target_grade: e.target.value })} className="input-field">
            {GRADES.map((g) => <option key={g} value={g}>{g || 'كل الصفوف'}</option>)}
          </select>
          <textarea
            placeholder="وصف إضافي (اختياري)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="input-field col-span-2"
            rows={2}
          />
        </div>
        <button onClick={add} className="btn-primary mt-3">إضافة المهمة</button>
      </div>

      {loading ? (
        <Spinner />
      ) : plans.length === 0 ? (
        <EmptyState icon="▤" title="مفيش خطط مذاكرة جاهزة لسه" />
      ) : (
        <div className="space-y-2 max-w-2xl">
          {plans.map((p) => (
            <div key={p.id} className="card p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{p.title}</p>
                <p className="text-xs text-muted truncate">
                  {p.subject_name} {p.target_grade ? `• ${p.target_grade}` : ''} {p.target_system ? `• ${p.target_system}` : ''}
                </p>
              </div>
              <button onClick={() => remove(p.id)} className="text-xs font-semibold text-muted hover:text-coral px-3 py-1.5 shrink-0">حذف</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
