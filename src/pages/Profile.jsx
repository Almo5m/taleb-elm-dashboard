import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Stamp, useToast } from '../components/UI';
import { useAppUser, useRefreshAppUser } from '../context/AppUser';
import { avatarUrlProblem } from '../lib/avatar';

export default function Profile() {
  const me = useAppUser();
  const refreshMe = useRefreshAppUser();
  const [avatarUrl, setAvatarUrl] = useState(me?.avatar_url || '');
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const changePassword = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      toast('كلمة المرور لازم تكون ٦ أحرف على الأقل', 'error');
      return;
    }
    if (password !== confirm) {
      toast('كلمتا المرور مش متطابقتين', 'error');
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast('تعذّر تغيير كلمة المرور', 'error', error);
      return;
    }
    setPassword('');
    setConfirm('');
    toast('تم تغيير كلمة المرور بنجاح');
  };

  const saveAvatar = async (e) => {
    e.preventDefault();
    const url = avatarUrl.trim();
    const problem = url ? avatarUrlProblem(url) : null;
    if (problem) { toast(problem, 'error'); return; }
    setSavingAvatar(true);
    const { data, error } = await supabase.from('profiles').update({ avatar_url: url || null }).eq('id', me.id).select('id');
    setSavingAvatar(false);
    if (error) { toast('تعذّر حفظ الصورة', 'error', error); return; }
    if (!data?.length) { toast('الصورة ماتحفظتش (الصلاحية رفضت). حدّث الصفحة وجرّب تاني', 'error'); return; }
    await refreshMe();
    toast(url ? 'تم حفظ صورتك. هتظهر في ردودك الجديدة على المنتدى' : 'تم مسح صورتك');
  };

  return (
    <div>
      <PageHeader eyebrow="حسابك الشخصي" title="الملف الشخصي" />

      <div className="card p-5 mb-6 max-w-md">
        <div className="flex items-center gap-3 mb-1">
          <p className="font-semibold">{me?.name || 'بدون اسم'}</p>
          <Stamp tone={me?.role === 'admin' ? 'accent' : 'ink'}>{me?.role === 'admin' ? 'أدمن كامل' : 'مشرف'}</Stamp>
        </div>
      </div>

      <form onSubmit={saveAvatar} className="card p-5 mb-6 max-w-md">
        <p className="font-messiri font-bold mb-1">صورتك في المنتدى</p>
        <p className="text-xs text-muted mb-4">
          الصورة دي بتتبعت مع ردودك الجديدة على أسئلة الطلاب. من غيرها الرد بيظهر في التطبيق بدون صورة.
        </p>
        <div className="flex items-center gap-3 mb-4">
          {me?.avatar_url ? (
            <img src={me.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-ink shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-ink text-accent flex items-center justify-center text-lg font-messiri shrink-0">
              {(me?.name || '؟').charAt(0)}
            </div>
          )}
          <p className="text-sm text-muted">{me?.avatar_url ? 'صورتك الحالية' : 'مفيش صورة لحسابك دلوقتي'}</p>
        </div>
        <label className="text-sm font-semibold block mb-1.5" htmlFor="avatar-url">رابط الصورة (https)</label>
        <input
          id="avatar-url"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          dir="ltr"
          placeholder="https://..."
          className="input-field mb-4 text-left"
        />
        <button type="submit" disabled={savingAvatar} className="btn-primary">
          {savingAvatar ? 'جارِ الحفظ...' : 'حفظ الصورة'}
        </button>
      </form>

      <form onSubmit={changePassword} className="card p-5 max-w-md">
        <p className="font-messiri font-bold mb-1">تغيير كلمة المرور</p>
        <p className="text-xs text-muted mb-4">هتحتاج تسجّل دخول تاني بكلمة المرور الجديدة في المرة الجاية</p>

        <label className="text-sm font-semibold block mb-1.5">كلمة المرور الجديدة</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-field mb-4"
          required
          minLength={6}
        />

        <label className="text-sm font-semibold block mb-1.5">تأكيد كلمة المرور</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="input-field mb-5"
          required
          minLength={6}
        />

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'جارِ الحفظ...' : 'تغيير كلمة المرور'}
        </button>
      </form>
    </div>
  );
}
