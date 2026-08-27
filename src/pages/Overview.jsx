import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp } from '../components/UI';

function topSubjects(threads) {
  const counts = {};
  threads.forEach((t) => {
    const key = t.subject_name;
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function daysAgoLabel(n) {
  const days = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  const d = new Date();
  d.setDate(d.getDate() - n);
  return days[d.getDay()];
}

export default function Overview() {
  const [stats, setStats] = useState({ users: 0, threads: 0, replies: 0, banned: 0, reports: 0 });
  const [weekly, setWeekly] = useState(Array(7).fill(0));
  const [activity, setActivity] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [signupsError, setSignupsError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiInfo, setAiInfo] = useState({ loading: true, error: false, enabled: false, count: null, limit: null, activeStudents: 0 });
  const [health, setHealth] = useState({ status: 'idle', latencyMs: null });

  const checkHealth = async () => {
    setHealth({ status: 'checking', latencyMs: null });
    const started = performance.now();
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const { error } = await supabase.functions.invoke('admin-ai-usage', {
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
      if (error) throw error;
      setHealth({ status: 'ok', latencyMs: Math.round(performance.now() - started) });
    } catch {
      setHealth({ status: 'error', latencyMs: Math.round(performance.now() - started) });
    }
  };

  useEffect(() => {
    load();
    loadAiInfo();
  }, []);

  const loadAiInfo = async () => {
    try {
      const [{ data: settingsRow }, { count: activeStudents }] = await Promise.all([
        supabase.from('app_settings').select('value').eq('key', 'ai_assistant').maybeSingle(),
        supabase.from('ai_access').select('*', { count: 'exact', head: true }).eq('enabled', true),
      ]);
      const settings = settingsRow?.value || {};
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('admin-ai-usage', {
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
      if (error) throw error;
      setAiInfo({
        loading: false,
        error: false,
        enabled: !!settings.enabled,
        count: data?.message_count ?? 0,
        limit: settings.monthly_limit_global ?? 3000,
        activeStudents: activeStudents || 0,
      });
    } catch {
      setAiInfo((prev) => ({ ...prev, loading: false, error: true }));
    }
  };

  const load = async () => {
    setLoading(true);
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 7);

    const [
      usersRes,
      threadsRes,
      repliesRes,
      bannedRes,
      reportsRes,
      signupsRes,
      recentThreadsRes,
      recentReportsRes,
      subjectRowsRes,
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('forum_threads').select('*', { count: 'exact', head: true }),
      supabase.from('forum_replies').select('*', { count: 'exact', head: true }),
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('banned', true),
      supabase.from('forum_reports').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('profiles').select('created_at').gte('created_at', fourteenDaysAgo.toISOString()).order('created_at', { ascending: false }).limit(1000),
      supabase.from('forum_threads').select('id, title, author_name, created_at').order('created_at', { ascending: false }).limit(5),
      supabase.from('forum_reports').select('id, reason, created_at').order('created_at', { ascending: false }).limit(4),
      supabase.from('forum_threads').select('subject_name').not('subject_name', 'is', null).limit(2000),
    ]);

    // نطبع أي خطأ في الكونسول عشان تشخيص أسهل لو حصلت مشكلة تاني
    [usersRes, threadsRes, repliesRes, bannedRes, reportsRes, signupsRes, recentThreadsRes, recentReportsRes, subjectRowsRes].forEach((r) => {
      if (r.error) console.error('Overview query error:', r.error);
    });
    setSignupsError(signupsRes.error ? signupsRes.error.message : null);

    const { count: users } = usersRes;
    const { count: threads } = threadsRes;
    const { count: replies } = repliesRes;
    const { count: banned } = bannedRes;
    const { count: reports } = reportsRes;
    const { data: signups } = signupsRes;
    const { data: recentThreads } = recentThreadsRes;
    const { data: recentReports } = recentReportsRes;
    const { data: subjectRows } = subjectRowsRes;

    setStats({ users: users || 0, threads: threads || 0, replies: replies || 0, banned: banned || 0, reports: reports || 0 });

    const buckets = Array(7).fill(0);
    (signups || []).forEach((s) => {
      const diff = Math.floor((Date.now() - new Date(s.created_at).getTime()) / 86400000);
      if (diff >= 0 && diff < 7) buckets[6 - diff]++;
    });
    setWeekly(buckets);

    const merged = [
      ...(recentThreads || []).map((t) => ({ kind: 'thread', ...t })),
      ...(recentReports || []).map((r) => ({ kind: 'report', ...r })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
    setActivity(merged);
    setSubjects(topSubjects(subjectRows || []));

    setLoading(false);
  };

  const cards = [
    { label: 'إجمالي الطلاب', value: stats.users, icon: '◉', tone: 'ink' },
    { label: 'أسئلة المنتدى', value: stats.threads, icon: '◈', tone: 'ink' },
    { label: 'الردود', value: stats.replies, icon: '✎', tone: 'ink' },
    { label: 'بلاغات معلّقة', value: stats.reports, icon: '⚑', tone: 'coral' },
    { label: 'حسابات محظورة', value: stats.banned, icon: '⊘', tone: 'coral' },
  ];

  if (loading) return <Spinner />;

  const maxBar = Math.max(...weekly, 1);

  return (
    <div>
      <PageHeader eyebrow="لوحة التحكم" title="نظرة عامة" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="card p-5">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg mb-3 ${c.tone === 'coral' ? 'bg-coral/10 text-coral' : 'bg-ink text-gold'}`}>
              {c.icon}
            </div>
            <p className="text-2xl font-extrabold font-messiri">{c.value}</p>
            <p className="text-sm text-muted">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <div className="card p-6">
          <p className="font-messiri font-bold mb-1">تسجيلات آخر ٧ أيام</p>
          <p className="text-xs text-muted mb-5">عدد الطلاب اللي عملوا حساب جديد</p>
          {signupsError && (
            <p className="text-xs text-coral-dark bg-coral/10 border border-coral/30 rounded-lg px-2 py-1.5 mb-3">
              تعذّر تحميل بيانات التسجيلات: {signupsError}
            </p>
          )}
          <div className="flex justify-between gap-2 h-32">
            {weekly.map((v, i) => (
              <div key={i} className="flex-1 flex flex-col justify-end items-center gap-2">
                <div
                  className="w-full rounded-t-md bg-ink/90"
                  style={{ height: `${Math.max((v / maxBar) * 100, v > 0 ? 8 : 2)}%`, background: v === 0 ? '#E7DFC9' : undefined }}
                  title={`${v}`}
                />
                <span className="text-[10px] text-muted">{daysAgoLabel(6 - i)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-3">
            إجمالي التسجيلات في آخر ٧ أيام: {weekly.reduce((a, b) => a + b, 0)} من إجمالي {stats.users} حساب
          </p>
        </div>

        <div className="card p-6">
          <p className="font-messiri font-bold mb-1">أكتر المواد سؤالًا</p>
          <p className="text-xs text-muted mb-5">من عناوين أسئلة المنتدى</p>
          {subjects.length === 0 ? (
            <p className="text-sm text-muted">مفيش بيانات كفاية لسه</p>
          ) : (
            <div className="space-y-3">
              {subjects.map(([name, count]) => {
                const max = subjects[0][1];
                return (
                  <div key={name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-semibold">{name}</span>
                      <span className="text-muted">{count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-parchment overflow-hidden">
                      <div className="h-full bg-gold rounded-full" style={{ width: `${(count / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <div className="card p-6">
          <div className="flex items-center justify-between mb-1">
            <p className="font-messiri font-bold">المساعد الذكي</p>
            <Link to="/settings" className="text-xs font-semibold text-muted hover:text-inktext">الإعدادات ←</Link>
          </div>
          <p className="text-xs text-muted mb-5">الاستهلاك الشهري مقابل السقف الإجمالي</p>
          {aiInfo.loading ? (
            <p className="text-sm text-muted">جارِ التحميل...</p>
          ) : aiInfo.error ? (
            <p className="text-sm text-coral-dark">تعذّر تحميل بيانات المساعد الذكي</p>
          ) : !aiInfo.enabled ? (
            <p className="text-sm text-muted">المساعد الذكي مش مفعّل حاليًا من الإعدادات</p>
          ) : (
            <>
              <p className="text-2xl font-extrabold font-messiri mb-1">
                {aiInfo.count.toLocaleString('en-US')} <span className="text-sm font-normal text-muted">/ {aiInfo.limit.toLocaleString('en-US')} رسالة</span>
              </p>
              <div className="h-2 rounded-full bg-parchment overflow-hidden mb-3">
                <div className="h-full bg-gold rounded-full" style={{ width: `${Math.min((aiInfo.count / (aiInfo.limit || 1)) * 100, 100)}%` }} />
              </div>
              {aiInfo.activeStudents === 0 ? (
                <p className="text-xs text-coral-dark bg-coral/10 border border-coral/30 rounded-lg px-2 py-1.5">
                  الميزة مفعّلة بس مفيش أي طالب مفعّل له الوصول من صفحة الحسابات
                </p>
              ) : (
                <p className="text-xs text-muted">{aiInfo.activeStudents} طالب مفعّل له الوصول حاليًا</p>
              )}
            </>
          )}
        </div>

        <div className="card p-6">
          <p className="font-messiri font-bold mb-1">صحة النظام</p>
          <p className="text-xs text-muted mb-5">فحص فوري لـ Edge Functions</p>

          <div className="flex items-center gap-3">
            <button onClick={checkHealth} disabled={health.status === 'checking'} className="btn-primary !px-4 !py-2 text-xs">
              {health.status === 'checking' ? 'جارِ الفحص...' : 'فحص admin-ai-usage الآن'}
            </button>
            {health.status === 'ok' && (
              <span className="text-xs text-forest font-semibold">شغالة ✅ ({health.latencyMs}ms)</span>
            )}
            {health.status === 'error' && (
              <span className="text-xs text-coral-dark font-semibold">فيها مشكلة ⚠️ — راجع Logs في Edge Functions</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-5">
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="font-messiri font-bold">آخر نشاط</p>
            <Link to="/forum" className="text-xs font-semibold text-muted hover:text-inktext">كل المنتدى ←</Link>
          </div>
          {activity.length === 0 ? (
            <p className="text-sm text-muted">مفيش نشاط لسه</p>
          ) : (
            <div className="space-y-3">
              {activity.map((a) => (
                <div key={`${a.kind}-${a.id}`} className="flex items-center gap-3 pb-3 border-b border-parchment-line last:border-0 last:pb-0">
                  {a.kind === 'thread' ? <Stamp tone="ink">سؤال</Stamp> : <Stamp tone="coral">بلاغ</Stamp>}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{a.kind === 'thread' ? a.title : a.reason}</p>
                    <p className="text-xs text-muted">
                      {a.kind === 'thread' ? a.author_name : 'بلاغ جديد'} • {new Date(a.created_at).toLocaleDateString('ar-EG')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}