import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, EmptyState, Stamp, useToast } from '../components/UI';
import { exportToCsv } from '../lib/csv';

export default function Leaderboard() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('total_study_hours');

  useEffect(() => {
    load();
  }, [sortBy]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('user_stats').select('*').order(sortBy, { ascending: false }).limit(50);
    if (error) toast('تعذّر تحميل المتصدرين', 'error', error);
    setRows(data || []);
    setLoading(false);
  };

  const sortOptions = [
    { key: 'total_study_hours', label: 'ساعات المذاكرة' },
    { key: 'current_streak', label: 'الاستمرارية (Streak)' },
    { key: 'achievements_count', label: 'عدد الإنجازات' },
  ];

  const exportCsv = () => {
    exportToCsv('لوحة-التصنيف.csv', rows, [
      { key: 'display_name', label: 'الاسم' },
      { key: 'total_study_hours', label: 'ساعات المذاكرة' },
      { key: 'current_streak', label: 'الاستمرارية' },
      { key: 'achievements_count', label: 'عدد الإنجازات' },
    ]);
  };

  return (
    <div>
      <PageHeader
        eyebrow="أفضل الطلاب"
        title="لوحة التصنيف"
        action={<button onClick={exportCsv} className="btn-ghost">تصدير CSV ⭳</button>}
      />

      <div className="flex gap-2 mb-6 flex-wrap">
        {sortOptions.map((o) => (
          <button
            key={o.key}
            onClick={() => setSortBy(o.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition ${
              sortBy === o.key ? 'bg-ink text-surface border-ink' : 'border-surface-line text-muted hover:border-ink'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="☰" title="مفيش بيانات في لوحة التصنيف لسه" hint="بتتحدث تلقائيًا من التطبيق كل ما الطالب يذاكر" />
      ) : (
        <div className="card divide-y divide-surface-line overflow-hidden">
          {rows.map((r, i) => (
            <div key={r.user_id} className="flex items-center gap-4 p-4">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-messiri font-bold text-sm shrink-0 ${
                  i === 0 ? 'bg-accent text-ink' : i === 1 ? 'bg-surface-line text-inktext' : i === 2 ? 'bg-coral/20 text-coral-dark' : 'bg-surface text-muted'
                }`}
              >
                {i + 1}
              </div>
              {r.avatar_url ? (
                <img src={r.avatar_url} className="w-9 h-9 rounded-full object-cover border-2 border-ink shrink-0" alt="" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-ink text-accent flex items-center justify-center text-xs font-messiri shrink-0">
                  {(r.display_name || '؟').charAt(0)}
                </div>
              )}
              <p className="font-semibold flex-1 min-w-0 truncate">{r.display_name || 'طالب'}</p>
              <div className="flex gap-2 shrink-0">
                <Stamp tone="ink">{Number(r.total_study_hours || 0).toFixed(1)} ساعة</Stamp>
                <Stamp tone="forest">{r.current_streak || 0} يوم</Stamp>
                <Stamp tone="accent">{r.achievements_count || 0} إنجاز</Stamp>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
