import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState, useToast, useConfirm } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';
import { exportToCsv } from '../lib/csv';

const GRADES = ['الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];

export default function Accounts() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState('الكل');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [aiFilter, setAiFilter] = useState('الكل');
  const [aiAccess, setAiAccess] = useState({});
  const [selected, setSelected] = useState(new Set());
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: aiRows, error: aiError }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('ai_access').select('*'),
    ]);
    if (error) toast('تعذّر تحميل الحسابات', 'error');
    setProfiles(data || []);
    if (!aiError && aiRows) {
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
      return matchesSearch && matchesGrade && matchesStatus && matchesAi;
    });
  }, [profiles, search, gradeFilter, statusFilter, aiFilter, aiAccess]);

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
    const { error } = await supabase.from('profiles').update({ banned: true }).in('id', ids);
    if (error) { toast('حصل خطأ أثناء الحظر الجماعي', 'error'); return; }
    setProfiles((prev) => prev.map((p) => (ids.includes(p.id) ? { ...p, banned: true } : p)));
    audit('bulk_ban', null, `حظر جماعي لـ ${ids.length} حساب`);
    toast(`تم حظر ${ids.length} حساب`);
    clearSelection();
  };

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
        eyebrow={`${profiles.length} حساب مسجّل`}
        title="إدارة الحسابات"
        action={<button onClick={exportCsv} className="btn-ghost">تصدير CSV ⭳</button>}
      />

      <div className="card p-4 mb-4 flex flex-col md:flex-row gap-3">
        <input
          placeholder="ابحث بالاسم أو الإيميل"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field md:flex-1"
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
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex gap-2 text-sm">
          <button onClick={selectAllVisible} className="font-semibold text-muted hover:text-inktext">تحديد الكل ({filtered.length})</button>
          {selected.size > 0 && (
            <button onClick={clearSelection} className="font-semibold text-muted hover:text-inktext">إلغاء التحديد</button>
          )}
        </div>
        {selected.size > 0 && (
          <button onClick={bulkBan} className="btn-danger !px-4 !py-2 text-sm">حظر المحدَّدين ({selected.size})</button>
        )}
      </div>

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
                  <div className="w-10 h-10 rounded-full bg-ink text-gold flex items-center justify-center text-sm font-messiri shrink-0">
                    {(p.name || '؟').charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-semibold flex items-center gap-2 flex-wrap">
                    {p.name || 'بدون اسم'}
                    {p.role === 'admin' && <Stamp tone="gold">أدمن</Stamp>}
                    {p.role === 'moderator' && <Stamp tone="ink">مشرف</Stamp>}
                    {p.banned && <Stamp tone="coral">محظور</Stamp>}
                    {getAiAccess(p.id).enabled && <Stamp tone="forest">AI مفعّل</Stamp>}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {p.email || '—'} · {p.system || '—'} • {p.grade || '—'} {p.track ? `• ${p.track}` : ''}
                  </p>
                  <p className="text-xs text-muted/70 mt-0.5">
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
