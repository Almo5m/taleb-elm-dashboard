import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState } from '../components/UI';

const DAY = 24 * 60 * 60 * 1000;

function activityTone(updatedAt) {
  if (!updatedAt) return 'ink';
  const diff = Date.now() - new Date(updatedAt).getTime();
  if (diff <= DAY) return 'forest';
  if (diff <= 7 * DAY) return 'gold';
  return 'coral';
}

function activityLabel(updatedAt) {
  if (!updatedAt) return 'مفيش بيانات نشاط';
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / DAY);
  if (days <= 0) return 'النهاردة';
  if (days === 1) return 'من يوم';
  return `من ${days} يوم`;
}

export default function UserActivity() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortDir, setSortDir] = useState('desc'); // desc = الأحدث نشاطًا فوق

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_stats')
      .select('user_id, display_name, avatar_url, updated_at')
      .order('updated_at', { ascending: false, nullsFirst: false });
    if (error) console.error('User activity load error:', error);
    setRows(data || []);
    setLoading(false);
  };

  const { activeToday, activeWeek } = useMemo(() => {
    const now = Date.now();
    let today = 0;
    let week = 0;
    for (const r of rows) {
      if (!r.updated_at) continue;
      const diff = now - new Date(r.updated_at).getTime();
      if (diff <= DAY) today += 1;
      if (diff <= 7 * DAY) week += 1;
    }
    return { activeToday: today, activeWeek: week };
  }, [rows]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : -1;
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : -1;
      return sortDir === 'desc' ? bTime - aTime : aTime - bTime;
    });
    return copy;
  }, [rows, sortDir]);

  return (
    <div>
      <PageHeader eyebrow="تحليلات" title="نشاط المستخدمين" />
      <p className="text-xs text-muted mb-6 -mt-4">
        آخر نشاط بيتحسب من آخر مرة اتعمل فيها مزامنة بيانات الطالب — بيتحدّث كل مرة يفتح فيها التطبيق
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="card p-4">
          <p className="text-2xl font-extrabold font-messiri">{activeToday}</p>
          <p className="text-xs text-muted mt-1">نشط آخر 24 ساعة</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-extrabold font-messiri">{activeWeek}</p>
          <p className="text-xs text-muted mt-1">نشط آخر 7 أيام</p>
        </div>
        <div className="card p-4">
          <p className="text-2xl font-extrabold font-messiri">{rows.length}</p>
          <p className="text-xs text-muted mt-1">إجمالي المسجّلين في الإحصائيات</p>
        </div>
      </div>

      <div className="flex justify-end mb-3">
        <button onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))} className="btn-ghost text-xs">
          {sortDir === 'desc' ? 'الأحدث نشاطًا أولًا ▾' : 'الأقدم نشاطًا أولًا ▴'}
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : sorted.length === 0 ? (
        <EmptyState icon="◇" title="مفيش بيانات نشاط لسه" />
      ) : (
        <div className="card divide-y divide-parchment-line overflow-hidden">
          {sorted.map((r) => (
            <Link
              key={r.user_id}
              to={`/accounts/${r.user_id}`}
              className="flex items-center gap-4 p-4 hover:bg-parchment/60"
            >
              <div className="w-9 h-9 rounded-full bg-ink text-gold flex items-center justify-center text-xs font-messiri shrink-0 overflow-hidden">
                {r.avatar_url ? (
                  <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  (r.display_name || '؟').charAt(0)
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{r.display_name || 'مستخدم'}</p>
              </div>
              <div className="text-left shrink-0">
                <Stamp tone={activityTone(r.updated_at)}>{activityLabel(r.updated_at)}</Stamp>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
