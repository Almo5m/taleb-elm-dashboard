import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Stamp, useToast } from '../components/UI';
import { useAppUser } from '../context/AppUser';

export default function Profile() {
  const me = useAppUser();
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

  return (
    <div>
      <PageHeader eyebrow="حسابك الشخصي" title="الملف الشخصي" />

      <div className="card p-5 mb-6 max-w-md">
        <div className="flex items-center gap-3 mb-1">
          <p className="font-semibold">{me?.name || 'بدون اسم'}</p>
          <Stamp tone={me?.role === 'admin' ? 'accent' : 'ink'}>{me?.role === 'admin' ? 'أدمن كامل' : 'مشرف'}</Stamp>
        </div>
      </div>

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
