import { useState } from 'react';
import { supabase } from '../supabaseClient';
import BrandLogo from '../components/BrandLogo';

export default function Login({ onLoggedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError('الإيميل أو كلمة المرور غلط');
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();

    if (profile?.role !== 'admin' && profile?.role !== 'moderator') {
      setError('الحساب ده مش من فريق الإدارة — لوحة التحكم دي مخصصة للإدارة بس');
      await supabase.auth.signOut();
      setLoading(false);
      return;
    }

    setLoading(false);
    onLoggedIn();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink px-4 relative overflow-hidden">
      {/* توهج هادي واحد بلون الهوية، من غير أي زخرفة تانية */}
      <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

      <form onSubmit={handleLogin} className="relative bg-surface-card border border-surface-line rounded-card p-8 w-full max-w-sm shadow-card animate-riseIn">
        <BrandLogo size="lg" className="mb-5" />
        <p className="font-messiri text-accent-dark text-sm font-semibold mb-1">طالب علم</p>
        <h1 className="text-xl font-bold mb-1 font-messiri">لوحة تحكم الإدارة</h1>
        <p className="text-sm text-muted mb-6">تسجيل دخول خاص بالإدارة فقط</p>

        <label className="text-sm font-semibold block mb-1.5">الإيميل</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input-field mb-4"
          required
        />

        <label className="text-sm font-semibold block mb-1.5">كلمة المرور</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input-field mb-5"
          required
        />

        {error && (
          <p className="text-coral-dark bg-coral/10 border-2 border-coral/30 rounded-xl px-3 py-2 text-sm mb-4 font-semibold">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full !py-3">
          {loading ? 'جارِ الدخول...' : 'تسجيل الدخول'}
        </button>
      </form>
    </div>
  );
}
