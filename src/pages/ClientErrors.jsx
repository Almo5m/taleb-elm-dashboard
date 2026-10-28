import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState, useToast, useConfirm } from '../components/UI';

// آخر 1000 تقرير بس (حد PostgREST الافتراضي) — كفاية لتشخيص أي عطل جديد،
// والأقدم من 30 يوم بيتمسح تلقائيًا أو يدويًا بالزرار فوق.
const FETCH_LIMIT = 1000;
const GROUP_KEY_LENGTH = 120;
const DAY = 24 * 60 * 60 * 1000;

function formatDate(value) {
  return new Date(value).toLocaleString('ar-EG');
}

// ⚠️ كل محتوى الجدول ده جاي من أجهزة مجهولة (anon) يعني غير موثوق — بنعرضه
// دايمًا كنص عادي جوه React (مفيش dangerouslySetInnerHTML خالص) عشان أي HTML
// أو سكريبت جوه message/stack يتعرض كنص ومايتنفّذش.
function StackBox({ error }) {
  return (
    <div className="bg-parchment/60 rounded-lg p-3 mt-2">
      <p className="text-[11px] text-muted mb-2">
        {error.platform || '—'} · {error.context || '—'} · جهاز: <span dir="ltr">{error.device_id?.slice(0, 8)}…</span>
      </p>
      <pre dir="ltr" className="text-[11px] whitespace-pre-wrap break-all text-left max-h-64 overflow-y-auto">
        {error.stack || 'مفيش stack مسجّل'}
      </pre>
    </div>
  );
}

export default function ClientErrors() {
  const toast = useToast();
  const confirm = useConfirm();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState('الكل');
  const [view, setView] = useState('grouped'); // grouped | list
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('client_errors')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(FETCH_LIMIT);
    if (error) console.error('client_errors load error:', error);
    setLoadError(!!error);
    setRows(data || []);
    setLoading(false);
  };

  const versions = useMemo(
    () => [...new Set(rows.map((r) => r.app_version).filter(Boolean))].sort().reverse(),
    [rows]
  );

  const filtered = useMemo(
    () => (version === 'الكل' ? rows : rows.filter((r) => r.app_version === version)),
    [rows, version]
  );

  // تجميع حسب أول ~120 حرف من الرسالة، مع عدد الأجهزة المختلفة — عشان نفرّق بين
  // عطل متكرر على جهاز واحد وعطل عند ناس كتير. الصفوف جاية مرتبة من الأحدث،
  // فأول صف لكل مجموعة هو آخر ظهور ليها.
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of filtered) {
      const key = (r.message || '(بدون رسالة)').slice(0, GROUP_KEY_LENGTH);
      let g = map.get(key);
      if (!g) {
        g = { key, count: 0, devices: new Set(), versions: new Set(), latest: r };
        map.set(key, g);
      }
      g.count += 1;
      g.devices.add(r.device_id);
      if (r.app_version) g.versions.add(r.app_version);
    }
    return [...map.values()].sort((a, b) => b.devices.size - a.devices.size || b.count - a.count);
  }, [filtered]);

  const removeOne = async (id) => {
    const ok = await confirm('متأكد إنك عايز تمسح التقرير ده؟', { danger: true, confirmLabel: 'حذف' });
    if (!ok) return;
    const { error } = await supabase.from('client_errors').delete().eq('id', id);
    if (error) {
      toast('تعذّر الحذف', 'error');
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast('اتمسح التقرير');
  };

  const removeOld = async () => {
    const ok = await confirm('هتمسح كل التقارير الأقدم من 30 يوم. متأكد؟', {
      danger: true,
      confirmLabel: 'مسح الأقدم',
    });
    if (!ok) return;
    const cutoff = new Date(Date.now() - 30 * DAY).toISOString();
    const { error, count } = await supabase
      .from('client_errors')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (error) {
      toast('تعذّر الحذف', 'error');
      return;
    }
    toast(`اتمسح ${count ?? 0} تقرير`);
    load();
  };

  return (
    <div>
      <PageHeader
        eyebrow="تحليلات"
        title="أعطال التطبيق"
        action={<button onClick={removeOld} className="btn-ghost">مسح الأقدم من 30 يوم</button>}
      />
      <p className="text-xs text-muted mb-6 -mt-4">
        تقارير مجهولة من التطبيق (من غير اسم ولا إيميل) — آخر {FETCH_LIMIT} تقرير
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex gap-2">
          {[['grouped', 'مجمّع حسب الرسالة'], ['list', 'الأحدث أولًا']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setView(key); setOpenKey(null); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                view === key ? 'bg-ink text-gold' : 'bg-parchment text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={version}
          onChange={(e) => { setVersion(e.target.value); setOpenKey(null); }}
          className="input-field md:w-48"
        >
          <option>الكل</option>
          {versions.map((v) => <option key={v}>{v}</option>)}
        </select>
        <span className="text-xs text-muted">{filtered.length} تقرير</span>
      </div>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <EmptyState icon="⚠" title="تعذّر تحميل التقارير" hint="تأكد إنك شغّلت supabase_client_errors.sql وإن حسابك أدمن" />
      ) : filtered.length === 0 ? (
        <EmptyState icon="✓" title="مفيش أعطال مسجّلة" />
      ) : view === 'grouped' ? (
        <div className="card divide-y divide-parchment-line overflow-hidden">
          {groups.map((g) => (
            <div key={g.key} className="p-4">
              <button onClick={() => setOpenKey(openKey === g.key ? null : g.key)} className="w-full text-right">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm break-words" dir="auto">{g.key}</p>
                    <p className="text-[11px] text-muted mt-1">
                      آخر ظهور: {formatDate(g.latest.created_at)}
                      {g.versions.size > 0 && ` · الإصدارات: ${[...g.versions].join('، ')}`}
                    </p>
                  </div>
                  <div className="text-left shrink-0 flex flex-col items-end gap-1">
                    <Stamp tone={g.devices.size > 1 ? 'coral' : 'gold'}>{g.devices.size} جهاز</Stamp>
                    <span className="text-[11px] text-muted">{g.count} مرة</span>
                  </div>
                </div>
              </button>
              {openKey === g.key && <StackBox error={g.latest} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="card divide-y divide-parchment-line overflow-hidden">
          {filtered.map((r) => (
            <div key={r.id} className="p-4">
              <div className="flex items-start gap-4">
                <button
                  onClick={() => setOpenKey(openKey === r.id ? null : r.id)}
                  className="flex-1 min-w-0 text-right"
                >
                  <p className="font-semibold text-sm break-words" dir="auto">
                    {(r.message || '(بدون رسالة)').slice(0, 200)}
                  </p>
                  <p className="text-[11px] text-muted mt-1">
                    {formatDate(r.created_at)} · {r.app_version || '—'}
                  </p>
                </button>
                <button
                  onClick={() => removeOne(r.id)}
                  className="text-muted hover:text-coral font-bold shrink-0"
                  aria-label="حذف"
                >
                  ×
                </button>
              </div>
              {openKey === r.id && <StackBox error={r} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
