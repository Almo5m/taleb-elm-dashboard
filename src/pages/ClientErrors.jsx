import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState, CopyButton, CopyText, useToast, useConfirm } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';
import { fetchAll } from '../lib/fetchAll';
import { timeAgo } from '../lib/timeAgo';
import {
  DAY_MS, STATUS_LABEL, allVersions, buildDailySeries, cairoDate, connNoneStats, describeExtra, filterGroups,
  groupReportText, isMissingRelation, sortGroups, statusPayload, summaryText, validateStatusForm,
} from '../lib/clientErrors';

// ⚠️ كل محتوى الصفحة دي جاي من أجهزة مجهولة (anon) يعني غير موثوق. بنعرضه دايمًا كنص عادي
// جوه React (مفيش dangerouslySetInnerHTML خالص) عشان أي HTML أو سكريبت جوه الرسالة أو الـ stack
// يتعرض كنص ومايتنفّذش.
//
// الصفحة مبنية على views محسوبة على السيرفر (sql/supabase_client_errors_v2.sql):
//   client_error_groups / client_error_daily / client_error_status
// التجميع والبصمة والتصنيف (bug / network) والـ regressed كلها بتتحسب هناك، مش في JavaScript.

const MESSAGE_PREVIEW = 140;
const DETAIL_REPORTS = 20;

const STATUS_TONE = { open: 'gold', fixed: 'forest', ignored: 'ink' };

const fullDate = (value) => (value ? new Date(value).toLocaleString('ar-EG') : '—');
const preview = (text) => {
  const t = text || '(بدون رسالة)';
  return t.length > MESSAGE_PREVIEW ? `${t.slice(0, MESSAGE_PREVIEW)}…` : t;
};

/* ============ رسم بياني بسيط: خطين (باج / شبكة) لآخر 30 يوم ============ */
function DailyChart({ rows, metric }) {
  const series = useMemo(() => buildDailySeries(rows, { days: 30, metric }), [rows, metric]);
  const max = Math.max(1, ...series.bug, ...series.network);
  const W = 640;
  const H = 150;
  const P = { l: 28, r: 8, t: 8, b: 20 };
  const x = (i) => P.l + (i * (W - P.l - P.r)) / (series.labels.length - 1);
  const y = (v) => P.t + (1 - v / max) * (H - P.t - P.b);
  const path = (vals) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const empty = series.bug.every((v) => v === 0) && series.network.every((v) => v === 0);
  const unit = metric === 'devices' ? 'جهاز' : 'تقرير';

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" role="img" aria-label="رسم بياني للأعطال آخر 30 يوم" dir="ltr">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} className="stroke-parchment-line" strokeWidth="1" />
            <text x={P.l - 4} y={y(max * f) + 3} textAnchor="end" className="fill-muted" fontSize="9">{Math.round(max * f)}</text>
          </g>
        ))}
        <path d={path(series.network)} fill="none" className="stroke-ink/60" strokeWidth="2" strokeDasharray="4 3" />
        <path d={path(series.bug)} fill="none" className="stroke-coral" strokeWidth="2.5" />
        {series.labels.map((day, i) => (
          <g key={day}>
            <rect x={x(i) - 6} y={P.t} width="12" height={H - P.t - P.b} fill="transparent">
              <title>{`${day} — باجات: ${series.bug[i]} ${unit} · شبكة: ${series.network[i]} ${unit}`}</title>
            </rect>
            {series.bug[i] > 0 && <circle cx={x(i)} cy={y(series.bug[i])} r="2.5" className="fill-coral" />}
          </g>
        ))}
        {[0, 14, 29].map((i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === 29 ? 'end' : 'middle'} className="fill-muted" fontSize="9">
            {series.labels[i].slice(5)}
          </text>
        ))}
      </svg>
      <div className="flex gap-4 text-xs text-muted mt-1">
        <span><span className="inline-block w-3 h-0.5 bg-coral align-middle ml-1" /> باجات</span>
        <span><span className="inline-block w-3 h-0.5 bg-ink/60 align-middle ml-1" /> شبكة</span>
        {empty && <span>مفيش أعطال في آخر 30 يوم ✓</span>}
      </div>
    </div>
  );
}

/* ============ تفاصيل عطل واحد ============ */
function GroupDetail({ group: g, onChanged, onDeleted }) {
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();

  const [reports, setReports] = useState(null);
  const [status, setStatus] = useState(g.status || 'open');
  const [fixedIn, setFixedIn] = useState(g.fixed_in_version || '');
  const [note, setNote] = useState(g.note || '');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('client_errors')
        .select('id, created_at, app_version, device_id, extra')
        .eq('signature', g.signature)
        .order('created_at', { ascending: false })
        .limit(DETAIL_REPORTS);
      if (cancelled) return;
      if (error) toast('تعذّر تحميل آخر تقارير العطل', 'error', error);
      setReports(data || []);
    })();
    return () => { cancelled = true; };
  }, [g.signature]);

  const none = useMemo(() => connNoneStats(reports || []), [reports]);

  const save = async () => {
    const problem = validateStatusForm({ status, fixedIn });
    setFormError(problem || '');
    if (problem) return;
    setSaving(true);
    const { error } = await supabase
      .from('client_error_status')
      .upsert(statusPayload({ signature: g.signature, status, fixedIn, note }), { onConflict: 'signature' });
    setSaving(false);
    if (error) { toast('تعذّر حفظ حالة العطل', 'error', error); return; }
    logAction({
      adminId: me?.id, adminName: me?.name || 'أدمن', action: 'client_error_status', targetType: 'client_error', targetId: g.signature,
      details: `${STATUS_LABEL[status]}${status === 'fixed' ? ` في ${fixedIn.trim()}` : ''}: ${preview(g.sample_message).slice(0, 80)}`,
    });
    toast('اتحفظت حالة العطل');
    onChanged();
  };

  const removeGroup = async () => {
    const ok = await confirm(`هتمسح كل تقارير العطل ده (${g.reports} تقرير). حالته (مفتوح/اتصلح/متجاهَل) هتفضل محفوظة. متأكد؟`, {
      danger: true, confirmLabel: 'حذف التقارير',
    });
    if (!ok) return;
    const { error, count } = await supabase.from('client_errors').delete({ count: 'exact' }).eq('signature', g.signature);
    if (error) { toast('تعذّر حذف تقارير العطل', 'error', error); return; }
    logAction({
      adminId: me?.id, adminName: me?.name || 'أدمن', action: 'client_error_delete', targetType: 'client_error', targetId: g.signature,
      details: `حذف ${count ?? 0} تقرير عطل: ${preview(g.sample_message).slice(0, 80)}`,
    });
    toast(`اتمسح ${count ?? 0} تقرير`);
    onDeleted();
  };

  const stackLines = (g.sample_stack || '').split('\n');

  return (
    <div className="bg-parchment/60 rounded-lg p-4 mt-3 select-text space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold break-words flex-1 min-w-0" dir="auto">{g.sample_message || '(بدون رسالة)'}</p>
        <CopyButton text={() => groupReportText(g, reports || [])} label="نسخ تقرير العطل" className="btn-primary !px-3 !py-1 text-xs shrink-0" />
      </div>

      <div>
        <p className="text-xs text-muted mb-1">
          أول ظهور {fullDate(g.first_seen)} · آخر ظهور {fullDate(g.last_seen)} · البصمة{' '}
          <CopyText value={g.signature} className="text-[11px]"><span dir="ltr">{String(g.signature).slice(0, 12)}…</span></CopyText>
        </p>
        <pre dir="ltr" className="text-[11px] whitespace-pre-wrap break-all text-left max-h-64 overflow-y-auto select-text bg-white/60 rounded-lg p-3">
          {g.top_frame && <span className="font-bold text-coral-dark block mb-1">▶ {g.top_frame}</span>}
          {stackLines.length > 0 && g.sample_stack ? g.sample_stack : 'مفيش stack مسجّل'}
        </pre>
      </div>

      <div>
        <p className="text-sm font-semibold mb-2">آخر {DETAIL_REPORTS} تقرير</p>
        {reports === null ? (
          <p className="text-xs text-muted">بيتحمّل…</p>
        ) : reports.length === 0 ? (
          <p className="text-xs text-muted">مفيش تقارير خام (اتمسحت)</p>
        ) : (
          <>
            <p className={`text-xs mb-2 ${none.mostlyNone ? 'text-coral-dark font-semibold' : 'text-muted'}`}>
              {none.none} من {none.total} جهاز كان بدون نت (من آخر {reports.length} تقرير).
              {none.mostlyNone && ' أغلبها كده، فالعطل غالبًا مشكلة نت حتى لو مش مصنّف شبكة.'}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted text-right">
                    <th className="font-semibold pb-1 pl-3">الوقت</th>
                    <th className="font-semibold pb-1 pl-3">الإصدار</th>
                    <th className="font-semibold pb-1 pl-3">الجهاز</th>
                    <th className="font-semibold pb-1">الحالة وقت العطل</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    const extra = describeExtra(r.extra);
                    return (
                      <tr key={r.id} className="border-t border-parchment-line align-top">
                        <td className="py-1.5 pl-3 whitespace-nowrap" title={fullDate(r.created_at)}>{timeAgo(r.created_at)}</td>
                        <td className="py-1.5 pl-3 whitespace-nowrap" dir="ltr">{r.app_version || '—'}</td>
                        <td className="py-1.5 pl-3" dir="ltr">
                          <CopyText value={r.device_id}>{String(r.device_id || '').slice(0, 8) || '—'}</CopyText>
                        </td>
                        <td className="py-1.5">{extra.length > 0 ? extra.join(' · ') : <span className="text-muted">— (تقرير قديم)</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted mt-2">رقم الجهاز عشوائي على الجهاز نفسه، مش مربوط بحساب طالب.</p>
          </>
        )}
      </div>

      <div className="border-t border-parchment-line pt-3">
        <p className="text-sm font-semibold mb-2">حالة العطل</p>
        <div className="flex flex-wrap gap-4 mb-2 text-sm">
          {[['open', 'مفتوح'], ['fixed', 'اتصلح'], ['ignored', 'متجاهَل']].map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name={`status-${g.signature}`} checked={status === key} onChange={() => { setStatus(key); setFormError(''); }} className="accent-coral" />
              {label}
            </label>
          ))}
        </div>
        {status === 'fixed' && (
          <div className="mb-2">
            <input
              value={fixedIn}
              onChange={(e) => { setFixedIn(e.target.value); setFormError(''); }}
              placeholder="اتصلح في إصدار (مثال: 3.0.1+4)"
              dir="ltr"
              className="input-field md:w-72 text-left"
              aria-label="الإصدار اللي اتصلح فيه"
            />
          </div>
        )}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="ملاحظة (اختياري)"
          maxLength={500}
          rows={2}
          className="input-field w-full mb-2"
          aria-label="ملاحظة"
        />
        {formError && <p className="text-xs text-coral-dark font-semibold mb-2" role="alert">{formError}</p>}
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={save} disabled={saving} className="btn-primary !px-4 !py-1.5 text-sm">
            {saving ? 'بيتحفظ…' : 'حفظ الحالة'}
          </button>
          <button type="button" onClick={removeGroup} className="btn-ghost !px-4 !py-1.5 text-sm text-coral-dark">حذف تقارير العطل ده</button>
        </div>
      </div>
    </div>
  );
}

/* ============ الصفحة ============ */
export default function ClientErrors() {
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const regressedOnly = params.get('filter') === 'regressed';

  const [groups, setGroups] = useState([]);
  const [daily, setDaily] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('bug');
  const [statusFilter, setStatusFilter] = useState('active');
  const [version, setVersion] = useState('الكل');
  const [rangeDays, setRangeDays] = useState(null);
  const [sortBy, setSortBy] = useState('devices');
  const [metric, setMetric] = useState('devices');
  const [openSig, setOpenSig] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const since = cairoDate(Date.now() - 30 * DAY_MS);
    const [g, d] = await Promise.all([
      fetchAll(() => supabase.from('client_error_groups').select('*').order('signature')),
      fetchAll(() => supabase.from('client_error_daily').select('*').gte('day', since).order('day').order('kind').order('app_version')),
    ]);
    if (isMissingRelation(g.error) || isMissingRelation(d.error)) {
      setMissing(true);
      setLoading(false);
      return;
    }
    setMissing(false);
    if (g.error) toast('تعذّر تحميل الأعطال', 'error', g.error);
    if (d.error) toast('تعذّر تحميل بيانات الرسم البياني', 'error', d.error);
    setGroups(g.data || []);
    setDaily(d.data || []);
    setLoading(false);
  };

  const versions = useMemo(() => allVersions(groups), [groups]);

  const visible = useMemo(
    () => sortGroups(filterGroups(groups, { tab, statusFilter, version, rangeDays, regressedOnly }), sortBy),
    [groups, tab, statusFilter, version, rangeDays, regressedOnly, sortBy]
  );

  const counts = useMemo(() => {
    const c = { bug: 0, network: 0, regressed: 0 };
    for (const g of groups) {
      if (g.status !== 'ignored') c[g.kind] = (c[g.kind] || 0) + 1;
      if (g.regressed) c.regressed += 1;
    }
    return c;
  }, [groups]);

  const removeOld = async () => {
    const ok = await confirm('هتمسح كل التقارير الأقدم من 30 يوم. حالات الأعطال (مفتوح/اتصلح/متجاهَل) هتفضل. متأكد؟', {
      danger: true, confirmLabel: 'مسح الأقدم',
    });
    if (!ok) return;
    const cutoff = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const { error, count } = await supabase.from('client_errors').delete({ count: 'exact' }).lt('created_at', cutoff);
    if (error) { toast('تعذّر الحذف', 'error', error); return; }
    toast(`اتمسح ${count ?? 0} تقرير`);
    load();
  };

  const filtersLabel = () => {
    const parts = [regressedOnly ? 'رجعت تاني فقط' : (tab === 'bug' ? 'باجات' : 'أخطاء الشبكة')];
    if (!regressedOnly) {
      if (version !== 'الكل') parts.push(`الإصدار ${version}`);
      if (rangeDays) parts.push(`آخر ${rangeDays} يوم`);
    }
    return `الفلتر: ${parts.join(' · ')}`;
  };

  if (loading) return <Spinner />;

  if (missing) {
    return (
      <div>
        <PageHeader eyebrow="تحليلات" title="أعطال التطبيق" />
        <EmptyState
          icon="⚙"
          title="لازم تشغّل ملف الأعطال الجديد الأول"
          hint="شغّل supabase_client_errors_v2.sql في Supabase (SQL Editor) وبعدها حدّث الصفحة. الملف بيضيف الـ views اللي بتجمّع الأعطال وتحدد الباجات الحقيقية."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="تحليلات"
        title="أعطال التطبيق"
        action={
          <div className="flex gap-2 flex-wrap">
            <CopyButton text={() => summaryText(visible, { filters: filtersLabel() })} label="نسخ ملخص الأعطال" className="btn-ghost" />
            <button onClick={() => load()} className="btn-ghost">تحديث</button>
            <button onClick={removeOld} className="btn-ghost">مسح الأقدم من 30 يوم</button>
          </div>
        }
      />
      <p className="text-xs text-muted mb-5 -mt-4">
        تقارير مجهولة من التطبيق (من غير اسم ولا إيميل). الأولوية لعدد الأجهزة المختلفة المتأثرة مش عدد المرات.
      </p>

      <div className="card p-5 mb-5">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <p className="font-messiri font-bold">آخر 30 يوم</p>
          <div className="flex gap-1">
            {[['devices', 'أجهزة'], ['reports', 'تقارير']].map(([key, label]) => (
              <button key={key} onClick={() => setMetric(key)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${metric === key ? 'bg-ink text-gold' : 'bg-parchment text-muted'}`}>{label}</button>
            ))}
          </div>
        </div>
        <DailyChart rows={daily} metric={metric} />
        <p className="text-[11px] text-muted mt-1">بعد كل إصدار جديد: الخط الأحمر (الباجات) المفروض ينزل. عدد الأجهزة تقريبي لو جهاز غيّر إصداره في نفس اليوم.</p>
      </div>

      {regressedOnly && (
        <div className="flex items-center gap-3 mb-4 bg-coral/10 border border-coral/30 rounded-xl px-4 py-2.5 text-sm">
          <span className="font-semibold text-coral-dark">عرض الأعطال اللي رجعت تاني بعد الإصلاح فقط</span>
          <button onClick={() => setParams({})} className="btn-ghost !px-2.5 !py-1 text-xs mr-auto">عرض الكل</button>
        </div>
      )}

      {!regressedOnly && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex gap-2">
            {[['bug', `باجات (${counts.bug})`], ['network', `أخطاء الشبكة (${counts.network})`]].map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setTab(key); setOpenSig(null); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${tab === key ? 'bg-ink text-gold' : 'bg-parchment text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field md:w-44" aria-label="فلتر الحالة">
            <option value="active">من غير المتجاهَل</option>
            <option value="open">مفتوح</option>
            <option value="fixed">اتصلح</option>
            <option value="ignored">متجاهَل</option>
            <option value="all">الكل</option>
          </select>
          <select value={version} onChange={(e) => setVersion(e.target.value)} className="input-field md:w-40" aria-label="فلتر الإصدار">
            <option>الكل</option>
            {versions.map((v) => <option key={v}>{v}</option>)}
          </select>
          <select value={rangeDays ?? ''} onChange={(e) => setRangeDays(e.target.value ? Number(e.target.value) : null)} className="input-field md:w-40" aria-label="فلتر المدة">
            <option value="">كل المدة</option>
            <option value="7">آخر 7 أيام</option>
            <option value="30">آخر 30 يوم</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="input-field md:w-44" aria-label="الترتيب">
            <option value="devices">الأكتر أجهزة</option>
            <option value="last_seen">الأحدث ظهورًا</option>
            <option value="reports">الأكتر تقارير</option>
          </select>
          {counts.regressed > 0 && (
            <button onClick={() => setParams({ filter: 'regressed' })} className="text-xs font-semibold text-coral-dark underline underline-offset-4">
              {counts.regressed} رجعوا تاني
            </button>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState icon="✓" title={groups.length === 0 ? 'مفيش أعطال مسجّلة' : 'مفيش أعطال بالفلتر ده'} />
      ) : (
        <div className="card divide-y divide-parchment-line overflow-hidden">
          {visible.map((g) => (
            <div key={g.signature} className={`p-4 ${g.regressed ? 'border-r-4 border-coral bg-coral/5' : ''}`}>
              <div className="flex items-start gap-2">
                <button onClick={() => setOpenSig(openSig === g.signature ? null : g.signature)} className="flex-1 min-w-0 text-right">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {g.regressed && <span className="bg-coral text-white text-[11px] font-bold rounded-md px-2 py-0.5">رجع تاني</span>}
                        <Stamp tone={STATUS_TONE[g.status] || 'ink'}>
                          {STATUS_LABEL[g.status] || g.status}{g.status === 'fixed' && g.fixed_in_version ? ` في ${g.fixed_in_version}` : ''}
                        </Stamp>
                      </div>
                      <p className="font-semibold text-sm break-words" dir="auto">{preview(g.sample_message)}</p>
                      {g.top_frame && <p className="text-[11px] text-muted mt-0.5 break-all" dir="ltr">{g.top_frame}</p>}
                      <p className="text-[11px] text-muted mt-1">
                        <span title={fullDate(g.last_seen)}>آخر ظهور {timeAgo(g.last_seen)}</span>
                        {(g.versions || []).length > 0 && <span dir="ltr"> · {g.versions.join(' · ')}</span>}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <Stamp tone={g.devices > 1 ? 'coral' : 'gold'}>{g.devices} جهاز</Stamp>
                      <span className="text-[11px] text-muted">{g.reports} تقرير</span>
                    </div>
                  </div>
                </button>
                <CopyButton text={() => groupReportText(g)} label="نسخ" className="btn-ghost !px-2.5 !py-1 text-xs shrink-0" />
              </div>
              {openSig === g.signature && (
                <GroupDetail
                  group={g}
                  onChanged={() => load({ quiet: true })}
                  onDeleted={() => { setOpenSig(null); load({ quiet: true }); }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
