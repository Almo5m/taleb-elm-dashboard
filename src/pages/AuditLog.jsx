import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState } from '../components/UI';
import { exportToCsv } from '../lib/csv';

const ACTION_TONE = {
  ban: 'coral',
  unban: 'forest',
  promote: 'gold',
  demote: 'coral',
  delete_thread: 'coral',
  delete_reply: 'coral',
  delete_report_content: 'coral',
  edit_profile: 'ink',
  publish_announcement: 'ink',
  hide_announcement: 'coral',
  bulk_ban: 'coral',
  bulk_delete_threads: 'coral',
  ai_enable: 'forest',
  ai_disable: 'coral',
  ai_limit_override: 'gold',
};

const ACTION_LABEL = {
  ban: 'حظر حساب',
  unban: 'إلغاء حظر',
  promote: 'ترقية',
  demote: 'سحب صلاحية',
  delete_thread: 'حذف سؤال',
  delete_reply: 'حذف رد',
  delete_report_content: 'حذف محتوى مُبلّغ عنه',
  edit_profile: 'تعديل بيانات حساب',
  publish_announcement: 'نشر رسالة عامة',
  hide_announcement: 'إخفاء رسالة عامة',
  bulk_ban: 'حظر جماعي',
  bulk_delete_threads: 'حذف جماعي لأسئلة',
  ai_enable: 'تفعيل المساعد الذكي',
  ai_disable: 'إيقاف المساعد الذكي',
  ai_limit_override: 'تعديل حد المساعد الذكي',
};

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('الكل');
  const [adminFilter, setAdminFilter] = useState('الكل');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    setRows(data || []);
    setLoading(false);
  };

  const admins = useMemo(() => {
    const names = new Set(rows.map((r) => r.admin_name || 'أدمن'));
    return ['الكل', ...Array.from(names).sort()];
  }, [rows]);

  const actionsPresent = useMemo(() => {
    const acts = new Set(rows.map((r) => r.action));
    return ['الكل', ...Array.from(acts).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
    const to = dateTo ? new Date(dateTo + 'T23:59:59') : null;
    return rows.filter((r) => {
      const matchesSearch = !q || (r.details || '').toLowerCase().includes(q) || (r.admin_name || '').toLowerCase().includes(q);
      const matchesAction = actionFilter === 'الكل' || r.action === actionFilter;
      const matchesAdmin = adminFilter === 'الكل' || (r.admin_name || 'أدمن') === adminFilter;
      const createdAt = new Date(r.created_at);
      const matchesFrom = !from || createdAt >= from;
      const matchesTo = !to || createdAt <= to;
      return matchesSearch && matchesAction && matchesAdmin && matchesFrom && matchesTo;
    });
  }, [rows, search, actionFilter, adminFilter, dateFrom, dateTo]);

  const exportCsv = () => {
    exportToCsv(
      'سجل-النشاط-طالب-علم.csv',
      filtered,
      [
        { key: 'created_at', label: 'التاريخ' },
        { key: 'admin_name', label: 'الأدمن' },
        { key: 'action', label: 'الإجراء' },
        { key: 'target_type', label: 'نوع الهدف' },
        { key: 'details', label: 'التفاصيل' },
      ]
    );
  };

  const clearFilters = () => {
    setSearch('');
    setActionFilter('الكل');
    setAdminFilter('الكل');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters = search || actionFilter !== 'الكل' || adminFilter !== 'الكل' || dateFrom || dateTo;

  return (
    <div>
      <PageHeader eyebrow="شفافية وتتبّع" title="سجل النشاط" />

      <div className="flex flex-wrap gap-2 mb-5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث في التفاصيل أو اسم الأدمن..."
          className="input-field flex-1 min-w-[200px]"
        />
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="input-field md:w-56">
          {actionsPresent.map((a) => (
            <option key={a} value={a}>{a === 'الكل' ? 'كل الإجراءات' : (ACTION_LABEL[a] || a)}</option>
          ))}
        </select>
        <select value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)} className="input-field md:w-44">
          {admins.map((a) => <option key={a}>{a}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field md:w-40" title="من تاريخ" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field md:w-40" title="إلى تاريخ" />
        {hasActiveFilters && (
          <button onClick={clearFilters} className="btn-ghost !px-3 text-xs">مسح الفلاتر</button>
        )}
        <button onClick={exportCsv} disabled={filtered.length === 0} className="btn-primary !px-4 text-xs">تصدير CSV</button>
      </div>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="⧉" title="مفيش نشاط مسجّل لسه" hint="كل إجراء إداري (حظر، حذف، ترقية) هيظهر هنا تلقائيًا" />
      ) : filtered.length === 0 ? (
        <EmptyState icon="⧉" title="مفيش نتائج مطابقة للفلاتر دي" />
      ) : (
        <div className="card divide-y divide-parchment-line overflow-hidden">
          {filtered.map((r) => (
            <div key={r.id} className="p-4 flex items-start gap-3">
              <Stamp tone={ACTION_TONE[r.action] || 'ink'}>{ACTION_LABEL[r.action] || r.action}</Stamp>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{r.details || r.target_type}</p>
                <p className="text-xs text-muted mt-0.5">
                  {r.admin_name || 'أدمن'} · {new Date(r.created_at).toLocaleString('ar-EG')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && rows.length === 500 && (
        <p className="text-xs text-muted mt-4">
          الفلاتر شغالة على آخر 500 إجراء بس (أحدث سجلات). لو محتاج تفتيش أبعد من كده، صدّر CSV بشكل دوري.
        </p>
      )}
    </div>
  );
}
