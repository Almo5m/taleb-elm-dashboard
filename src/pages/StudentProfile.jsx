import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, useToast, useConfirm } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';

const GRADES = ['الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];
const SYSTEMS = ['الثانوية العامة', 'البكالوريا المصرية'];
const ROLES = [
  { value: 'student', label: 'طالب' },
  { value: 'moderator', label: 'مشرف' },
  { value: 'admin', label: 'أدمن كامل' },
];

export default function StudentProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [form, setForm] = useState({ name: '', system: '', grade: '', track: '' });
  const [savingForm, setSavingForm] = useState(false);

  const [ai, setAi] = useState({ enabled: false, daily_limit_override: '' });
  const [savingAiEnabled, setSavingAiEnabled] = useState(false);
  const [savingAiLimit, setSavingAiLimit] = useState(false);
  const [aiUsage, setAiUsage] = useState({ loading: true, error: false, todayCount: null, dailyLimit: null });

  const [activity, setActivity] = useState({ loading: true, threads: 0, replies: 0 });

  const [savingRole, setSavingRole] = useState(false);
  const [savingBan, setSavingBan] = useState(false);

  useEffect(() => {
    load();
  }, [id]);

  const audit = (action, details) =>
    logAction({ adminId: me?.id, adminName: me?.name || 'أدمن', action, targetType: 'profile', targetId: id, details });

  const load = async () => {
    setLoading(true);
    const [{ data: p, error }, { data: accessRow }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
      supabase.from('ai_access').select('enabled, daily_limit_override').eq('user_id', id).maybeSingle(),
    ]);
    if (error || !p) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setProfile(p);
    setForm({ name: p.name || '', system: p.system || '', grade: p.grade || '', track: p.track || '' });
    setAi({ enabled: accessRow?.enabled || false, daily_limit_override: accessRow?.daily_limit_override ?? '' });
    setLoading(false);
    loadAiUsage();
    loadActivity();
  };

  const loadAiUsage = async () => {
    setAiUsage((prev) => ({ ...prev, loading: true, error: false }));
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('admin-ai-usage', {
        body: { user_id: id },
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
      if (error) throw error;
      if (!data?.student) throw new Error('missing student field');
      setAiUsage({ loading: false, error: false, todayCount: data.student.today_count, dailyLimit: data.student.daily_limit });
    } catch {
      setAiUsage({ loading: false, error: true, todayCount: null, dailyLimit: null });
    }
  };

  const loadActivity = async () => {
    setActivity((prev) => ({ ...prev, loading: true }));
    const [{ count: threads }, { count: replies }] = await Promise.all([
      supabase.from('forum_threads').select('*', { count: 'exact', head: true }).eq('author_id', id),
      supabase.from('forum_replies').select('*', { count: 'exact', head: true }).eq('author_id', id),
    ]);
    setActivity({ loading: false, threads: threads || 0, replies: replies || 0 });
  };

  const saveForm = async () => {
    setSavingForm(true);
    const { error } = await supabase.from('profiles').update(form).eq('id', id);
    setSavingForm(false);
    if (error) { toast('تعذّر حفظ التعديل', 'error'); return; }
    setProfile((prev) => ({ ...prev, ...form }));
    audit('edit_profile', `تعديل بيانات ${form.name || id}`);
    toast('تم حفظ التعديلات');
  };

  const changeRole = async (newRole) => {
    if (newRole === profile.role) return;
    const ok = await confirm(
      `هل تريد تغيير دور "${profile.name || 'الحساب'}" إلى "${ROLES.find((r) => r.value === newRole)?.label}"؟`,
      { danger: newRole === 'student', confirmLabel: 'تأكيد التغيير' }
    );
    if (!ok) return;
    setSavingRole(true);
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', id);
    setSavingRole(false);
    if (error) { toast('حصل خطأ، حاول تاني', 'error'); return; }
    setProfile((prev) => ({ ...prev, role: newRole }));
    audit(newRole === 'student' ? 'demote' : 'promote', `تغيير دور ${profile.name || id} إلى ${newRole}`);
    toast('تم تحديث الصلاحية');
  };

  const toggleBan = async () => {
    const ok = await confirm(
      profile.banned ? `هل تريد إلغاء حظر "${profile.name || 'الحساب'}"؟` : `هل تريد حظر "${profile.name || 'الحساب'}"؟ لن يقدر يدخل التطبيق بعدها.`,
      { danger: !profile.banned, confirmLabel: profile.banned ? 'إلغاء الحظر' : 'حظر الحساب' }
    );
    if (!ok) return;
    setSavingBan(true);
    const { error } = await supabase.from('profiles').update({ banned: !profile.banned }).eq('id', id);
    setSavingBan(false);
    if (error) { toast('حصل خطأ، حاول تاني', 'error'); return; }
    setProfile((prev) => ({ ...prev, banned: !prev.banned }));
    audit(profile.banned ? 'unban' : 'ban', `${profile.banned ? 'إلغاء حظر' : 'حظر'} ${profile.name || id}`);
    toast(profile.banned ? 'تم إلغاء الحظر' : 'تم حظر الحساب');
  };

  const sendPasswordReset = async () => {
    if (!profile.email) { toast('مفيش إيميل مسجل لهذا الحساب', 'error'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) { toast('تعذّر إرسال الرابط', 'error'); return; }
    toast(`تم إرسال رابط تغيير كلمة المرور إلى ${profile.email}`);
  };

  const deleteAccountPermanently = async () => {
    const ok = await confirm(
      `حذف نهائي لحساب "${profile.name || profile.email}" — هيتحذف الحساب وكل بياناته من قاعدة البيانات بشكل لا رجعة فيه. متأكد؟`,
      { danger: true, confirmLabel: 'حذف نهائي لا رجعة فيه' }
    );
    if (!ok) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const { error } = await supabase.functions.invoke('admin-delete-user', {
      body: { user_id: id },
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    });
    if (error) { toast('تعذّر الحذف — تأكد إن الـ Edge Function متنشورة (راجع README)', 'error'); return; }
    audit('delete_account', `حذف نهائي لحساب ${profile.name || profile.email || id}`);
    toast('تم حذف الحساب نهائيًا');
    navigate('/accounts');
  };

  const toggleAiEnabled = async () => {
    const nextEnabled = !ai.enabled;
    setSavingAiEnabled(true);
    const { error } = await supabase.from('ai_access').upsert({ user_id: id, enabled: nextEnabled }, { onConflict: 'user_id' });
    setSavingAiEnabled(false);
    if (error) { toast('تعذّر تحديث حالة المساعد الذكي', 'error'); return; }
    setAi((prev) => ({ ...prev, enabled: nextEnabled }));
    audit(nextEnabled ? 'ai_enable' : 'ai_disable', `${nextEnabled ? 'تفعيل' : 'إيقاف'} المساعد الذكي لـ ${profile.name || id}`);
    toast(nextEnabled ? 'تم تفعيل المساعد الذكي لهذا الطالب' : 'تم إيقاف المساعد الذكي لهذا الطالب');
    loadAiUsage();
  };

  const saveAiLimit = async () => {
    const raw = (ai.daily_limit_override ?? '').toString().trim();
    let value = null;
    if (raw !== '') {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        toast('الحد اليومي المخصص لازم يكون رقم صحيح أكبر من صفر، أو سيبه فاضي عشان يستخدم الحد العام', 'error');
        return;
      }
      value = parsed;
    }
    setSavingAiLimit(true);
    const { error } = await supabase.from('ai_access').upsert({ user_id: id, daily_limit_override: value }, { onConflict: 'user_id' });
    setSavingAiLimit(false);
    if (error) { toast('تعذّر حفظ الحد المخصص', 'error'); return; }
    setAi((prev) => ({ ...prev, daily_limit_override: value ?? '' }));
    audit('ai_limit_override', `تعديل الحد اليومي المخصص لـ ${profile.name || id} إلى ${value ?? 'الحد العام الافتراضي'}`);
    toast('تم حفظ الحد اليومي المخصص');
    loadAiUsage();
  };

  if (loading) return <Spinner />;

  if (notFound) {
    return (
      <div>
        <PageHeader eyebrow="الحسابات" title="الحساب غير موجود" />
        <p className="text-sm text-muted mb-4">الحساب ده يمكن يكون اتحذف بالفعل.</p>
        <Link to="/accounts" className="btn-ghost !inline-block">↩ الرجوع لقائمة الحسابات</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link to="/accounts" className="text-xs font-semibold text-muted hover:text-inktext">↩ كل الحسابات</Link>

      <div className="flex items-center gap-4 mt-3 mb-8">
        {profile.avatar_url ? (
          <img src={profile.avatar_url} className="w-16 h-16 rounded-full object-cover border-2 border-ink" alt="" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-ink text-gold flex items-center justify-center text-2xl font-messiri">
            {(profile.name || '؟').charAt(0)}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-messiri font-bold text-xl flex items-center gap-2 flex-wrap">
            {profile.name || 'بدون اسم'}
            {profile.role === 'admin' && <Stamp tone="gold">أدمن</Stamp>}
            {profile.role === 'moderator' && <Stamp tone="ink">مشرف</Stamp>}
            {profile.banned && <Stamp tone="coral">محظور</Stamp>}
          </p>
          <p className="text-sm text-muted truncate">{profile.email || '—'}</p>
          <p className="text-xs text-muted/70 mt-0.5">
            سجّل في {new Date(profile.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* البيانات الأساسية */}
      <div className="card p-5 mb-6">
        <p className="font-messiri font-bold mb-4">البيانات الأساسية</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-muted font-semibold">الاسم</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input-field mt-1" />
          </div>
          <div>
            <label className="text-xs text-muted font-semibold">النظام</label>
            <select value={form.system} onChange={(e) => setForm({ ...form, system: e.target.value, track: '' })} className="input-field mt-1">
              <option value="">—</option>
              {SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted font-semibold">الصف</label>
            <select value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} className="input-field mt-1">
              <option value="">—</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted font-semibold">الشعبة/المسار</label>
            <input value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })} className="input-field mt-1" placeholder="مثال: علمي علوم" />
          </div>
        </div>
        <button onClick={saveForm} disabled={savingForm} className="btn-primary">
          {savingForm ? 'جارِ الحفظ...' : 'حفظ البيانات'}
        </button>
      </div>

      {/* المساعد الذكي */}
      <div className="card p-5 mb-6">
        <p className="font-messiri font-bold mb-1">المساعد الذكي</p>
        <p className="text-xs text-muted mb-4">التحكم في وصول هذا الطالب للمساعد الذكي والاطّلاع على استهلاكه</p>

        <label className="flex items-center gap-3 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={ai.enabled}
            onChange={toggleAiEnabled}
            disabled={savingAiEnabled}
            className="w-5 h-5 accent-forest"
          />
          <span className="font-semibold text-sm">تفعيل المساعد الذكي لهذا الطالب</span>
        </label>

        <div className="flex items-end gap-2 mb-4">
          <div className="flex-1">
            <label className="text-xs text-muted font-semibold">حد يومي مخصص</label>
            <input
              type="number"
              min="1"
              placeholder="افتراضي لو فاضي"
              value={ai.daily_limit_override}
              onChange={(e) => setAi({ ...ai, daily_limit_override: e.target.value })}
              className="input-field mt-1"
            />
          </div>
          <button onClick={saveAiLimit} disabled={savingAiLimit} className="btn-ghost !px-4 !py-2 text-sm">
            {savingAiLimit ? 'جارِ الحفظ...' : 'حفظ الحد'}
          </button>
        </div>

        <div className="bg-parchment rounded-xl px-3 py-2.5">
          <p className="text-xs text-muted font-semibold mb-1">استهلاك النهاردة</p>
          {aiUsage.loading ? (
            <p className="text-sm text-muted">جارِ التحميل...</p>
          ) : aiUsage.error ? (
            <p className="text-sm text-coral-dark">تعذّر تحميل بيانات الاستهلاك — تأكد إن admin-ai-usage محدَّثة بآخر نسخة ومنشورة</p>
          ) : (
            <p className="text-sm font-semibold">
              {aiUsage.todayCount.toLocaleString('en-US')} / {aiUsage.dailyLimit.toLocaleString('en-US')} رسالة
            </p>
          )}
        </div>
      </div>

      {/* نشاط المنتدى */}
      <div className="card p-5 mb-6">
        <p className="font-messiri font-bold mb-4">نشاط المنتدى</p>
        {activity.loading ? (
          <p className="text-sm text-muted">جارِ التحميل...</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-2xl font-extrabold font-messiri">{activity.threads}</p>
              <p className="text-xs text-muted">سؤال نشره</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold font-messiri">{activity.replies}</p>
              <p className="text-xs text-muted">رد كتبه</p>
            </div>
          </div>
        )}
      </div>

      {/* الصلاحيات والحساب */}
      <div className="card p-5 mb-6">
        <p className="font-messiri font-bold mb-4">الصلاحيات والحساب</p>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <label className="text-xs text-muted font-semibold ml-1">الدور:</label>
          <select
            value={profile.role || 'student'}
            onChange={(e) => changeRole(e.target.value)}
            disabled={savingRole}
            className="input-field !w-auto"
          >
            {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={sendPasswordReset} className="btn-ghost !px-4 !py-2 text-sm">رابط تغيير كلمة المرور</button>
          {profile.role !== 'admin' && (
            <button onClick={toggleBan} disabled={savingBan} className={profile.banned ? 'btn-ghost !px-4 !py-2 text-sm' : 'btn-danger !px-4 !py-2 text-sm'}>
              {profile.banned ? 'إلغاء الحظر' : 'حظر الحساب'}
            </button>
          )}
        </div>
      </div>

      {/* منطقة الخطر */}
      {profile.role !== 'admin' && (
        <div className="card p-5 border-2 border-coral/30">
          <p className="font-messiri font-bold mb-1 text-coral-dark">منطقة الخطر</p>
          <p className="text-xs text-muted mb-4">حذف الحساب نهائي ولا يمكن التراجع عنه.</p>
          <button onClick={deleteAccountPermanently} className="btn-danger">حذف الحساب نهائيًا</button>
        </div>
      )}
    </div>
  );
}
