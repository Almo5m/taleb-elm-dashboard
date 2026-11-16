import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import { ToastProvider, ConfirmProvider, ErrorBoundary } from './components/UI';
import { AppUserProvider, useAppUser } from './context/AppUser';
import BrandLogo from './components/BrandLogo';
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
import UserActivity from './pages/UserActivity';
import Notifications from './pages/Notifications';
import Emails from './pages/Emails';
import ClientErrors from './pages/ClientErrors';
import Unlockables from './pages/Unlockables';
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
  { to: '/user-activity', label: 'نشاط المستخدمين', icon: '⟳', adminOnly: true },
  { to: '/notifications', label: 'الإشعارات', icon: '🔔', adminOnly: true },
  { to: '/emails', label: 'الإيميلات', icon: '✉', adminOnly: true },
  { to: '/unlockables', label: 'المميزات المقفولة', icon: '🔒', adminOnly: true },
  { to: '/client-errors', label: 'أعطال التطبيق', icon: '⚠', adminOnly: true },
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
        <div className="fixed inset-0 bg-ink/50 z-30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <aside
        className={`bg-ink text-surface w-72 lg:w-64 xl:w-72 p-4 lg:p-5 flex flex-col fixed lg:sticky top-0 h-screen max-h-[100dvh] z-40 transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : 'translate-x-full invisible lg:translate-x-0 lg:visible'
        }`}
      >
        <div className="flex items-center gap-3 mb-2 px-1">
          <BrandLogo size="md" />
          <div>
            <p className="font-messiri font-bold text-lg leading-tight">طالب علم</p>
            <p className="text-xs text-surface/50">لوحة التحكم</p>
          </div>
        </div>

        {me && (
          <div className="mt-1 mb-2 px-1">
            <span className={`stamp !rotate-0 !text-[10px] ${isAdmin ? 'text-accent' : 'text-surface/70'}`}>
              {isAdmin ? 'أدمن كامل' : 'مشرف'}
            </span>
          </div>
        )}

        <div className="my-4 h-px bg-surface/10" />

        <nav className="space-y-1 flex-1 overflow-y-auto overscroll-contain">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-4 py-2 lg:py-2.5 rounded-xl text-sm font-semibold transition ${
                  isActive
                    ? 'bg-accent/15 text-white'
                    : 'text-surface/70 hover:bg-white/5 hover:text-surface'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute -right-5 top-1/2 -translate-y-1/2 w-2.5 h-6 bg-accent rounded-l-full" />}
                  <span className={`w-5 text-center ${isActive ? 'text-accent' : ''}`}>{item.icon}</span>
                  <span className="flex-1 min-w-0">{item.label}</span>
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

        <div className="my-4 h-px bg-surface/10" />
        <button
          onClick={onLogout}
          className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-surface/70 hover:bg-white/5 hover:text-surface transition"
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
  const location = useLocation();
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
    <div className="min-h-screen flex bg-surface">
      <Sidebar onLogout={onLogout} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} pendingReports={pendingReports} />

      <div className="flex-1 min-w-0">
        <header className="lg:hidden sticky top-0 z-20 bg-surface/90 backdrop-blur border-b border-surface-line px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrandLogo size="sm" />
            <p className="font-messiri font-bold">لوحة التحكم</p>
          </div>
          <button onClick={() => setMobileOpen(true)} className="btn-ghost !px-3 !py-2 text-lg">☰</button>
        </header>

        <main className="p-4 sm:p-6 lg:p-8 xl:p-10 max-w-6xl mx-auto w-full">
          <ErrorBoundary key={location.pathname}>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/accounts" element={<AdminOnly><Accounts /></AdminOnly>} />
            <Route path="/accounts/:id" element={<AdminOnly><StudentProfile /></AdminOnly>} />
            <Route path="/forum" element={<Forum />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/user-activity" element={<AdminOnly><UserActivity /></AdminOnly>} />
            <Route path="/notifications" element={<AdminOnly><Notifications /></AdminOnly>} />
            <Route path="/emails" element={<AdminOnly><Emails /></AdminOnly>} />
            <Route path="/unlockables" element={<AdminOnly><Unlockables /></AdminOnly>} />
            <Route path="/client-errors" element={<AdminOnly><ClientErrors /></AdminOnly>} />
            <Route path="/announcement" element={<AdminOnly><Announcement /></AdminOnly>} />
            <Route path="/study-plans" element={<AdminOnly><StudyPlans /></AdminOnly>} />
            <Route path="/achievements" element={<AdminOnly><Achievements /></AdminOnly>} />
            <Route path="/banned-words" element={<AdminOnly><BannedWords /></AdminOnly>} />
            <Route path="/settings" element={<AdminOnly><Settings /></AdminOnly>} />
            <Route path="/audit-log" element={<AdminOnly><AuditLog /></AdminOnly>} />
            <Route path="/profile" element={<Profile />} />
          </Routes>
          </ErrorBoundary>
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
      <div className="min-h-screen flex items-center justify-center bg-surface text-muted gap-3">
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
