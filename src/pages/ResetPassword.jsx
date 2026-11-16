import { useEffect, useState } from 'react';
import BrandLogo from '../components/BrandLogo';
import { supabase } from '../supabaseClient';

export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // supabase-js بيقرا رمز الاسترجاع من رابط الإيميل تلقائيًا (#access_token=...&type=recovery)
    // ويعمل جلسة مؤقتة بس تكفي لتغيير كلمة المرور
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setHasSession(!!session);
        setReady(true);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('كلمة المرور لازم تكون ٦ أحرف على الأقل');
      return;
    }
    if (password !== confirm) {
      setError('كلمتا المرور مش متطابقتين');
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError('تعذّر تغيير كلمة المرور، جرّب تطلب رابط جديد');
      return;
    }
    await supabase.auth.signOut();
    setDone(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink px-4 relative overflow-hidden">
      {/* توهج هادي واحد بلون الهوية، زي صفحة الدخول */}
      <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

      <div className="relative bg-surface-card border border-surface-line rounded-card p-8 w-full max-w-sm shadow-card animate-riseIn">
        <BrandLogo size="lg" className="mb-5" />
        <p className="font-messiri text-accent-dark text-sm font-semibold mb-1">طالب علم</p>

        {!ready ? (
          <div className="flex items-center gap-3 text-muted py-6">
            <span className="w-4 h-4 rounded-full border-2 border-ink/20 border-t-ink animate-spin" />
            جارِ التحقق من الرابط...
          </div>
        ) : done ? (
          <>
            <h1 className="text-xl font-bold mb-2 font-messiri">تم تغيير كلمة المرور 🎉</h1>
            <p className="text-sm text-muted leading-relaxed">
              ارجع لتطبيق طالب علم وسجّل دخول بكلمة المرور الجديدة. تقدر تقفل الصفحة دي دلوقتي.
            </p>
          </>
        ) : !hasSession ? (
          <>
            <h1 className="text-xl font-bold mb-2 font-messiri">الرابط غير صالح</h1>
            <p className="text-sm text-muted leading-relaxed">
              الرابط ده منتهي الصلاحية أو استُخدم قبل كده. ارجع للتطبيق واطلب رابط تغيير كلمة مرور جديد.
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-xl font-bold mb-1 font-messiri">تعيين كلمة مرور جديدة</h1>
            <p className="text-sm text-muted mb-6">اكتب كلمة المرور الجديدة بتاعتك</p>

            <label className="text-sm font-semibold block mb-1.5">كلمة المرور الجديدة</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field mb-4"
              minLength={6}
              required
            />

            <label className="text-sm font-semibold block mb-1.5">تأكيد كلمة المرور</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input-field mb-5"
              minLength={6}
              required
            />

            {error && (
              <p className="text-coral-dark bg-coral/10 border-2 border-coral/30 rounded-xl px-3 py-2 text-sm mb-4 font-semibold">
                {error}
              </p>
            )}

            <button type="submit" disabled={saving} className="btn-primary w-full !py-3">
              {saving ? 'جارِ الحفظ...' : 'حفظ كلمة المرور'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
