import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState, useToast, useConfirm } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';
import { exportToCsv } from '../lib/csv';
import { fetchAll, inChunks } from '../lib/fetchAll';
import { GRADES, divisionStatus, isPendingTrack } from '../lib/divisions';
import PromotionPanel from '../components/PromotionPanel';
import DistributionCard from '../components/DistributionCard';


export default function Accounts() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [aiFilter, setAiFilter] = useState('الكل');
  const [aiAccess, setAiAccess] = useState({});
  const [planByUser, setPlanByUser] = useState({}); // user_id -> اسم الخطة الفعّالة
  const [bulkBusy, setBulkBusy] = useState(false);
  const [joinedFilter, setJoinedFilter] = useState('الكل');
  const [divisionFilter, setDivisionFilter] = useState('الكل'); // الكل | pending | invalid
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    // fetchAll: Supabase بيقطع أي استعلام عند 1000 صف من غير تنبيه، وده كان هيخفي الطلاب الزيادة
    const [{ data, error }, { data: aiRows, error: aiError }, planRes] = await Promise.all([
      fetchAll(() => supabase.from('profiles').select('*').order('created_at', { ascending: false }).order('id')),
      fetchAll(() => supabase.from('ai_access').select('*').order('user_id')),
      // الخطط اختيارية: لو الجدول لسه مااتعملش الشارة مش بتظهر وخلاص
      fetchAll(() => supabase.from('ai_subscriptions_view').select('id, user_id, plan_name').eq('effective_status', 'active').order('id')),
    ]);
    if (error) toast('تعذّر تحميل الحسابات', 'error', error);
    if (aiError) toast('تعذّر تحميل حالة المساعد الذكي — الأرقام المعروضة ممكن تكون ناقصة', 'error', aiError);
    setProfiles(data || []);
    if (!planRes.error) {
      const plans = {};
      planRes.data.forEach((r) => { plans[r.user_id] = r.plan_name; });
      setPlanByUser(plans);
    }
    if (aiRows) {
      const map = {};
      aiRows.forEach((r) => { map[r.user_id] = { enabled: r.enabled, daily_limit_override: r.daily_limit_override }; });
      setAiAccess(map);
    }
    setLoading(false);
  };

  const getAiAccess = (userId) => aiAccess[userId] || { enabled: false, daily_limit_override: null };

  const audit = (action, targetId, details) =>
    logAction({ adminId: me?.id, adminName: me?.name || 'أدمن', action, targetType: 'profile', targetId, details });

  const filtered = useMemo(() => {
    return profiles.filter((p) => {
      const matchesSearch =
        (p.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (p.email || '').toLowerCase().includes(search.toLowerCase());
      const matchesGrade = gradeFilter === 'الكل' || p.grade === gradeFilter;
      const matchesStatus =
        statusFilter === 'الكل' ||
        (statusFilter === 'محظور' && p.banned) ||
        (statusFilter === 'أدمن' && p.role === 'admin') ||
        (statusFilter === 'مشرف' && p.role === 'moderator') ||
        (statusFilter === 'نشط' && !p.banned && p.role === 'student');
      const aiEnabled = getAiAccess(p.id).enabled;
      const matchesAi =
        aiFilter === 'الكل' ||
        (aiFilter === 'مفعّل' && aiEnabled) ||
        (aiFilter === 'معطّل' && !aiEnabled);
      const joinedDays = joinedFilter === 'آخر 24 ساعة' ? 1 : joinedFilter === 'آخر 7 أيام' ? 7 : null;
      const matchesJoined = joinedDays === null || Date.now() - new Date(p.created_at).getTime() <= joinedDays * 86400000;
      const isStudent = (p.role || 'student') === 'student';
      const matchesDivision =
        divisionFilter === 'الكل' ||
        (divisionFilter === 'pending' && isStudent && isPendingTrack(p)) ||
        (divisionFilter === 'invalid' && isStudent && divisionStatus(p) === 'invalid');
      return matchesSearch && matchesGrade && matchesStatus && matchesAi && matchesJoined && matchesDivision;
    });
  }, [profiles, search, gradeFilter, statusFilter, aiFilter, joinedFilter, divisionFilter, aiAccess]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(filtered.filter((p) => p.role !== 'admin').map((p) => p.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const bulkBan = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirm(`هتحظر ${ids.length} حساب دفعة واحدة، متأكد؟`, { danger: true, confirmLabel: `حظر ${ids.length} حساب` });
    if (!ok) return;
    const { error, done } = await inChunks(ids, (part) => supabase.from('profiles').update({ banned: true }).in('id', part));
    if (error) {
      toast(`الحظر الجماعي وقف بعد ${done} من ${ids.length} حساب — اللي قبل كده اتنفّذ`, 'error', error);
      load();
      return;
    }
    setProfiles((prev) => prev.map((p) => (ids.includes(p.id) ? { ...p, banned: true } : p)));
    audit('bulk_ban', null, `حظر جماعي لـ ${ids.length} حساب`);
    toast(`تم حظر ${ids.length} حساب`);
    clearSelection();
  };

  // تفعيل/إيقاف المساعد الذكي لمجموعة طلاب دفعة واحدة (بيحافظ على الحد اليومي المخصص لكل طالب)
  const setAiForIds = async (ids, enabled) => {
    if (ids.length === 0 || bulkBusy) return;
    const label = enabled ? 'تفعيل' : 'إيقاف';
    const ok = await confirm(`هتعمل ${label} للمساعد الذكي لـ ${ids.length} طالب دفعة واحدة، متأكد؟`, {
      danger: !enabled,
      confirmLabel: `${label} لـ ${ids.length} طالب`,
    });
    if (!ok) return;
    setBulkBusy(true);
    const now = new Date().toISOString();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500).map((id) => ({ user_id: id, enabled, updated_at: now }));
      const { error } = await supabase.from('ai_access').upsert(chunk, { onConflict: 'user_id' });
      if (error) {
        toast(`${label} المساعد الذكي وقف عند ${i} من ${ids.length} — اللي قبل كده اتنفّذ`, 'error', error);
        setBulkBusy(false);
        load();
        return;
      }
    }
    setAiAccess((prev) => {
      const next = { ...prev };
      ids.forEach((id) => { next[id] = { daily_limit_override: null, ...(next[id] || {}), enabled }; });
      return next;
    });
    audit(enabled ? 'bulk_ai_enable' : 'bulk_ai_disable', null, `${label} المساعد الذكي لـ ${ids.length} طالب`);
    toast(`تم ${label} المساعد الذكي لـ ${ids.length} طالب`);
    setBulkBusy(false);
    clearSelection();
  };

  const pendingTrackCount = useMemo(
    () => profiles.filter((p) => (p.role || 'student') === 'student' && isPendingTrack(p)).length,
    [profiles]
  );
  const invalidDivisionCount = useMemo(
    () => profiles.filter((p) => (p.role || 'student') === 'student' && divisionStatus(p) === 'invalid').length,
    [profiles]
  );

  const studentsWithoutAi = useMemo(
    () => profiles.filter((p) => p.role === 'student' && !p.banned && !getAiAccess(p.id).enabled),
    [profiles, aiAccess]
  );
  const aiEnabledCount = useMemo(
    () => profiles.filter((p) => getAiAccess(p.id).enabled).length,
    [profiles, aiAccess]
  );

  const exportCsv = () => {
    exportToCsv(
      'حسابات-طالب-علم.csv',
      filtered,
      [
        { key: 'name', label: 'الاسم' },
        { key: 'email', label: 'الإيميل' },
        { key: 'system', label: 'النظام' },
        { key: 'grade', label: 'الصف' },
        { key: 'track', label: 'الشعبة' },
        { key: 'role', label: 'الدور' },
        { key: 'banned', label: 'محظور' },
        { key: 'created_at', label: 'تاريخ التسجيل' },
      ]
    );
  };

  return (
    <div>
      <PageHeader
        eyebrow={`${profiles.length} حساب مسجّل · المساعد الذكي مفعّل لـ ${aiEnabledCount}`}
        title="إدارة الحسابات"
        action={
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setPromotionOpen((v) => !v)} className="btn-ghost">نقل الصفوف (ترقية)</button>
            <button onClick={exportCsv} className="btn-ghost">تصدير CSV ⭳</button>
          </div>
        }
      />

      {promotionOpen && (
        <PromotionPanel
          onClose={() => setPromotionOpen(false)}
          onDone={() => { setPromotionOpen(false); load(); }}
        />
      )}

      {!loading && <DistributionCard profiles={profiles} onShowInvalid={() => setDivisionFilter('invalid')} />}

      {!loading && (pendingTrackCount > 0 || invalidDivisionCount > 0 || divisionFilter !== 'الكل') && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {pendingTrackCount > 0 && (
            <button
              onClick={() => setDivisionFilter(divisionFilter === 'pending' ? 'الكل' : 'pending')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${divisionFilter === 'pending' ? 'bg-ink text-accent' : 'bg-white border border-surface-line text-muted'}`}
            >
              في انتظار اختيار الشعبة: {pendingTrackCount}
            </button>
          )}
          {invalidDivisionCount > 0 && (
            <button
              onClick={() => setDivisionFilter(divisionFilter === 'invalid' ? 'الكل' : 'invalid')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${divisionFilter === 'invalid' ? 'bg-coral text-white' : 'bg-white border border-coral/40 text-coral-dark'}`}
            >
              تقسيم غير مطابق: {invalidDivisionCount}
            </button>
          )}
          {divisionFilter !== 'الكل' && (
            <button onClick={() => setDivisionFilter('الكل')} className="text-xs text-muted underline underline-offset-4">إلغاء الفلتر</button>
          )}
        </div>
      )}

      <div className="card p-4 mb-4 flex flex-col md:flex-row md:flex-wrap gap-3">
        <input
          placeholder="ابحث بالاسم أو الإيميل"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field md:flex-1 md:min-w-[16rem]"
        />
        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="input-field md:w-56">
          <option>الكل</option>
          {GRADES.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field md:w-40">
          {['الكل', 'نشط', 'مشرف', 'أدمن', 'محظور'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={aiFilter} onChange={(e) => setAiFilter(e.target.value)} className="input-field md:w-48">
          <option value="الكل">المساعد الذكي: الكل</option>
          <option value="مفعّل">المساعد الذكي: مفعّل</option>
          <option value="معطّل">المساعد الذكي: معطّل</option>
        </select>
        <select value={joinedFilter} onChange={(e) => setJoinedFilter(e.target.value)} className="input-field md:w-44">
          {['الكل', 'آخر 24 ساعة', 'آخر 7 أيام'].map((s) => <option key={s} value={s}>{s === 'الكل' ? 'التسجيل: الكل' : `سجّلوا ${s}`}</option>)}
        </select>
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-2 text-sm">
          <button onClick={selectAllVisible} className="font-semibold text-muted hover:text-inktext">تحديد الكل ({filtered.length})</button>
          {selected.size > 0 && (
            <button onClick={clearSelection} className="font-semibold text-muted hover:text-inktext">إلغاء التحديد</button>
          )}
        </div>
        {selected.size > 0 && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setAiForIds([...selected], true)} disabled={bulkBusy} className="btn-primary !px-4 !py-2 text-sm">
              تفعيل المساعد الذكي ({selected.size})
            </button>
            <button onClick={() => setAiForIds([...selected], false)} disabled={bulkBusy} className="btn-ghost !px-4 !py-2 text-sm">
              إيقاف المساعد الذكي ({selected.size})
            </button>
            <button onClick={bulkBan} className="btn-danger !px-4 !py-2 text-sm">حظر المحدَّدين ({selected.size})</button>
          </div>
        )}
      </div>

      {studentsWithoutAi.length > 0 && !loading && (
        <div className="card p-3 mb-4 flex items-center justify-between gap-3 flex-wrap bg-surface/60">
          <p className="text-sm text-muted">
            <span className="font-semibold text-inktext">{studentsWithoutAi.length}</span> طالب مالهمش المساعد الذكي مفعّل.
          </p>
          <button
            onClick={() => setAiForIds(studentsWithoutAi.map((p) => p.id), true)}
            disabled={bulkBusy}
            className="btn-primary !px-4 !py-2 text-sm"
          >
            فعّل المساعد لكلهم
          </button>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon="◉" title="مفيش حسابات مطابقة" hint="جرّب تغيّر البحث أو الفلاتر" />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Link
              to={`/accounts/${p.id}`}
              key={p.id}
              className="card p-4 flex items-center justify-between gap-3 flex-wrap hover:border-ink transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                {p.role !== 'admin' && (
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggleSelect(p.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 accent-ink shrink-0"
                  />
                )}
                {p.avatar_url ? (
                  <img src={p.avatar_url} className="w-10 h-10 rounded-full object-cover border-2 border-ink shrink-0" alt="" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-ink text-accent flex items-center justify-center text-sm font-messiri shrink-0">
                    {(p.name || '؟').charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold flex items-center gap-2 flex-wrap">
                    {p.name || 'بدون اسم'}
                    {p.role === 'admin' && <Stamp tone="accent">أدمن</Stamp>}
                    {p.role === 'moderator' && <Stamp tone="ink">مشرف</Stamp>}
                    {p.banned && <Stamp tone="coral">محظور</Stamp>}
                    {getAiAccess(p.id).enabled && <Stamp tone="forest">AI مفعّل</Stamp>}
                    {planByUser[p.id] && <Stamp tone="accent">خطة {planByUser[p.id]}</Stamp>}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {p.email || '—'} · {p.system || '—'} • {p.grade || '—'} {p.track ? `• ${p.track}` : ''}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    سجّل في {new Date(p.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-muted shrink-0">الملف الشخصي ←</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
