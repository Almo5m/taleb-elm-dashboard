import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, EmptyState, useToast, useConfirm } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';

const GRADES = ['', 'الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];
const SYSTEMS = ['', 'الثانوية العامة', 'البكالوريا المصرية'];

export default function Announcement() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ message: '', target_system: '', target_grade: '', starts_at: '', ends_at: '' });
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('announcements').select('*').eq('active', true).order('created_at', { ascending: false });
    if (error) toast('تعذّر تحميل الرسائل', 'error', error);
    setAnnouncements(data || []);
    setLoading(false);
  };

  const publish = async () => {
    if (!form.message.trim()) return;
    setSaving(true);
    const startsAt = form.starts_at ? new Date(form.starts_at).toISOString() : null;
    const isFuture = startsAt && new Date(startsAt) > new Date();
    const { error } = await supabase.from('announcements').insert({
      message: form.message.trim(),
      active: !isFuture, // لو موعدها لسه ما جاش، تفضل غير نشطة لحد ما cron يفعّلها
      target_system: form.target_system || null,
      target_grade: form.target_grade || null,
      starts_at: startsAt,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    });
    setSaving(false);
    if (error) { toast('تعذّر نشر الرسالة', 'error', error); return; }
    logAction({ adminId: me?.id, adminName: me?.name || 'أدمن', action: 'publish_announcement', targetType: 'announcement', details: form.message.trim().slice(0, 60) });
    setForm({ message: '', target_system: '', target_grade: '', starts_at: '', ends_at: '' });
    toast(isFuture ? 'تم جدولة الرسالة' : 'تم نشر الرسالة');
    load();
  };

  const remove = async (id, message) => {
    const ok = await confirm('هتشيل الرسالة دي من الظهور، متأكد؟', { danger: true, confirmLabel: 'إخفاء الرسالة' });
    if (!ok) return;
    const { error } = await supabase.from('announcements').update({ active: false }).eq('id', id);
    if (error) { toast('تعذّر إخفاء الرسالة', 'error', error); return; }
    setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    logAction({ adminId: me?.id, adminName: me?.name || 'أدمن', action: 'hide_announcement', targetType: 'announcement', targetId: id, details: (message || '').slice(0, 60) });
    toast('تم إخفاء الرسالة');
  };

  return (
    <div>
      <PageHeader eyebrow="التواصل مع الطلاب" title="رسالة عامة" />

      <div className="card p-5 mb-8 max-w-xl">
        <p className="text-sm text-muted mb-4">أضف رسالة جديدة تظهر لكل الطلاب فوق شاشة "اليوم"</p>
        <textarea
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          rows={3}
          placeholder="مثال: امتحانات نصف العام هتبدأ الأسبوع الجاي، ركزوا في المراجعة 💪"
          className="input-field mb-3"
        />
        <div className="grid grid-cols-2 gap-3 mb-3">
          <select value={form.target_system} onChange={(e) => setForm({ ...form, target_system: e.target.value })} className="input-field">
            {SYSTEMS.map((s) => <option key={s} value={s}>{s || 'كل الأنظمة'}</option>)}
          </select>
          <select value={form.target_grade} onChange={(e) => setForm({ ...form, target_grade: e.target.value })} className="input-field">
            {GRADES.map((g) => <option key={g} value={g}>{g || 'كل الصفوف'}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-muted font-semibold">تبدأ في (اختياري)</label>
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              className="input-field mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted font-semibold">تنتهي في (اختياري)</label>
            <input
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
              className="input-field mt-1"
            />
          </div>
        </div>
        <p className="text-xs text-muted mb-3">
          سيبهم فاضيين عشان الرسالة تنشر فورًا وتفضل شغالة لحد ما تشيلها بنفسك. الجدولة التلقائية محتاجة
          تفعيل pg_cron مرة واحدة من Supabase (تفاصيل في README).
        </p>
        <button onClick={publish} disabled={saving || !form.message.trim()} className="btn-primary">
          {saving ? 'جارِ النشر...' : 'نشر الرسالة'}
        </button>
      </div>

      <p className="font-messiri font-bold mb-3">الرسائل النشطة</p>
      {loading ? (
        <Spinner />
      ) : announcements.length === 0 ? (
        <EmptyState icon="✉" title="مفيش رسائل نشطة حاليًا" />
      ) : (
        <div className="space-y-3 max-w-xl">
          {announcements.map((a) => (
            <div key={a.id} className="card p-4">
              <p className="text-sm mb-2">{a.message}</p>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs text-muted">
                  {a.target_system || 'كل الأنظمة'} • {a.target_grade || 'كل الصفوف'}
                  {a.ends_at ? ` • تنتهي ${new Date(a.ends_at).toLocaleString('ar-EG')}` : ''} · {new Date(a.created_at).toLocaleString('ar-EG')}
                </p>
                <button onClick={() => remove(a.id, a.message)} className="text-xs font-semibold text-muted hover:text-coral px-2 py-1">إخفاء</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
