import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useNavigate, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { ToastProvider, ConfirmProvider } from './components/UI';
import { AppUserProvider, useAppUser } from './context/AppUser';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Forum from './pages/Forum';
import Accounts from './pages/Accounts';
import StudentProfile from './pages/StudentProfile';
import Reports from './pages/Reports';
import Announcement from './pages/Announcement';
import StudyPlans from './pages/StudyPlans';
import Achievements from './pages/Achievements';
import Leaderboard from './pages/Leaderboard';
import AuditLog from './pages/AuditLog';
import BannedWords from './pages/BannedWords';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import ResetPassword from './pages/ResetPassword';

const navItems = [
  { to: '/', label: 'نظرة عامة', icon: '◇', end: true },
  { to: '/accounts', label: 'الحسابات', icon: '◉', adminOnly: true },
  { to: '/forum', label: 'المنتدى', icon: '◈' },
  { to: '/reports', label: 'البلاغات', icon: '⚑' },
  { to: '/leaderboard', label: 'لوحة التصنيف', icon: '☰' },
  { to: '/announcement', label: 'رسالة عامة', icon: '✉', adminOnly: true },
  { to: '/study-plans', label: 'خطط مذاكرة', icon: '▤', adminOnly: true },
  { to: '/achievements', label: 'الإنجازات', icon: '★', adminOnly: true },
  { to: '/banned-words', label: 'الكلمات الممنوعة', icon: '⊘', adminOnly: true },
  { to: '/settings', label: 'إعدادات التطبيق', icon: '⚙', adminOnly: true },
  { to: '/audit-log', label: 'سجل النشاط', icon: '⧉', adminOnly: true },
  { to: '/profile', label: 'الملف الشخصي', icon: '⚉' },
];

function Sidebar({ onLogout, mobileOpen, setMobileOpen, pendingReports }) {
  const me = useAppUser();
  const isAdmin = me?.role === 'admin';
  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <aside
        className={`bg-ink text-parchment w-72 p-5 flex flex-col fixed md:sticky top-0 h-screen z-40 transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex items-center gap-3 mb-2 px-1">
          <div className="w-11 h-11 rounded-xl bg-gold text-ink flex items-center justify-center font-messiri font-extrabold text-xl shrink-0">ط</div>
          <div>
            <p className="font-messiri font-bold text-lg leading-tight">طالب علم</p>
            <p className="text-xs text-parchment/50">لوحة التحكم</p>
          </div>
        </div>

        {me && (
          <div className="mt-1 mb-2 px-1">
            <span className={`stamp !rotate-0 !text-[10px] ${isAdmin ? 'text-gold' : 'text-parchment/70'}`}>
              {isAdmin ? 'أدمن كامل' : 'مشرف'}
            </span>
          </div>
        )}

        <div className="my-4 h-px bg-parchment/10" />

        <nav className="space-y-1 flex-1 overflow-y-auto">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition ${
                  isActive
                    ? 'bg-parchment text-ink'
                    : 'text-parchment/70 hover:bg-white/5 hover:text-parchment'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute -right-5 top-1/2 -translate-y-1/2 w-2.5 h-6 bg-gold rounded-l-full" />}
                  <span className="w-5 text-center">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.to === '/reports' && pendingReports > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-coral text-white text-[11px] font-bold">
                      {pendingReports > 99 ? '99+' : pendingReports}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="my-4 h-px bg-parchment/10" />
        <button
          onClick={onLogout}
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-parchment/70 hover:bg-white/5 hover:text-parchment transition"
        >
          <span className="w-5 text-center">⏻</span> تسجيل خروج
        </button>
      </aside>
    </>
  );
}

function AdminOnly({ children }) {
  const me = useAppUser();
  if (me?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function Layout({ onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingReports, setPendingReports] = useState(0);

  useEffect(() => {
    let active = true;
    const loadCount = async () => {
      const { count } = await supabase.from('forum_reports').select('*', { count: 'exact', head: true }).eq('status', 'pending');
      if (active) setPendingReports(count || 0);
    };
    loadCount();

    // تحديث لحظي — أي بلاغ جديد يوصل أو حالته تتغيّر (تمت المراجعة/رجوع للمعلّقة)
    // بيحدّث الرقم فورًا من غير ما تحتاج تعمل ريفريش للصفحة
    const channel = supabase
      .channel('sidebar-pending-reports')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'forum_reports' }, () => {
        loadCount();
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="min-h-screen flex bg-parchment">
      <Sidebar onLogout={onLogout} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} pendingReports={pendingReports} />

      <div className="flex-1 min-w-0">
        <header className="md:hidden sticky top-0 z-20 bg-parchment/90 backdrop-blur border-b border-parchment-line px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-ink text-gold flex items-center justify-center font-messiri font-bold">ط</div>
            <p className="font-messiri font-bold">لوحة التحكم</p>
          </div>
          <button onClick={() => setMobileOpen(true)} className="btn-ghost !px-3 !py-2 text-lg">☰</button>
        </header>

        <main className="p-5 md:p-10 max-w-6xl mx-auto">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/accounts" element={<AdminOnly><Accounts /></AdminOnly>} />
            <Route path="/accounts/:id" element={<AdminOnly><StudentProfile /></AdminOnly>} />
            <Route path="/forum" element={<Forum />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/announcement" element={<AdminOnly><Announcement /></AdminOnly>} />
            <Route path="/study-plans" element={<AdminOnly><StudyPlans /></AdminOnly>} />
            <Route path="/achievements" element={<AdminOnly><Achievements /></AdminOnly>} />
            <Route path="/banned-words" element={<AdminOnly><BannedWords /></AdminOnly>} />
            <Route path="/settings" element={<AdminOnly><Settings /></AdminOnly>} />
            <Route path="/audit-log" element={<AdminOnly><AuditLog /></AdminOnly>} />
            <Route path="/profile" element={<Profile />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function Root() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    navigate('/');
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-parchment text-muted gap-3">
        <span className="w-4 h-4 rounded-full border-2 border-ink/20 border-t-ink animate-spin" />
        جارِ التحميل...
      </div>
    );
  }

  if (!session) {
    return <Login onLoggedIn={() => window.location.reload()} />;
  }

  return (
    <AppUserProvider userId={session.user.id}>
      <Layout onLogout={handleLogout} />
    </AppUserProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Routes>
          {/* صفحة عامة، مش محتاجة تسجيل دخول ومش جوه لوحة التحكم — لاستقبال رابط تغيير كلمة المرور */}
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/*" element={<Root />} />
        </Routes>
      </ConfirmProvider>
    </ToastProvider>
  );
}
