import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, Spinner, Stamp, useConfirm, useToast } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import SubscriptionDialog from '../components/ai/SubscriptionDialog';
import { logAction } from '../lib/audit';
import { fetchAll } from '../lib/fetchAll';
import { isMissingRelation } from '../lib/clientErrors';
import {
  SUB_TABS, daysLeft, filterSubscriptions, formatCairoDate, formatEgp, isExpiringSoon, tabCounts,
} from '../lib/aiPlans';

const PAGE_SIZE = 100;
const STATUS_STAMP = {
  active: ['forest', 'فعّال'],
  scheduled: ['accent', 'لسه مبدأش'],
  expired: ['amber', 'منتهي'],
  cancelled: ['coral', 'ملغي'],
};

// اشتراكات بو: الأدمن بيفعّل الاشتراك يدويًا بعد ما الطالب يدفع. مفيش مسح، الإلغاء بس.
export default function AiSubscriptions() {
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [rows, setRows] = useState([]);
  const [plans, setPlans] = useState([]);
  const [admins, setAdmins] = useState({});
  const [tab, setTab] = useState('active');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [dialog, setDialog] = useState(null); // null | { initial? }
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [subRes, planRes] = await Promise.all([
      fetchAll(() => supabase.from('ai_subscriptions_view').select('*').order('created_at', { ascending: false }).order('id', { ascending: false })),
      supabase.from('ai_plans').select('*').order('sort_order').order('id'),
    ]);
    const failure = subRes.error || planRes.error;
    if (failure) {
      if (isMissingRelation(failure)) { setMissing(true); setLoading(false); return; }
      toast('تعذّر تحميل الاشتراكات', 'error', failure);
      setLoading(false);
      return;
    }
    setMissing(false);
    setRows(subRes.data || []);
    setPlans(planRes.data || []);

    // أسماء الأدمن اللي فعّلوا (عددهم قليل، فطلب واحد يكفي)
    const adminIds = [...new Set((subRes.data || []).map((r) => r.activated_by).filter(Boolean))].slice(0, 100);
    if (adminIds.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', adminIds);
      setAdmins(Object.fromEntries((profiles || []).map((p) => [p.id, p.name])));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // فتح النموذج من صفحة الطالب (?student=<id>) مع الطالب مختار
  const studentParam = params.get('student');
  useEffect(() => {
    if (!studentParam) return;
    (async () => {
      const { data, error } = await supabase.from('profiles').select('id, name, email').eq('id', studentParam).maybeSingle();
      if (error) { toast('تعذّر تحميل بيانات الطالب', 'error', error); return; }
      if (data) setDialog({ initial: { student: data } });
      setParams({}, { replace: true });
    })();
  }, [studentParam, setParams, toast]);

  const counts = useMemo(() => tabCounts(rows), [rows]);
  const visible = useMemo(() => filterSubscriptions(rows, tab, query), [rows, tab, query]);

  const cancel = async (row) => {
    const ok = await confirm(`إلغاء اشتراك ${row.student_name || 'الطالب'} في خطة "${row.plan_name}"؟ بو هيقف عنده لو مش مفعّل له يدويًا.`, { danger: true, confirmLabel: 'ألغِ الاشتراك' });
    if (!ok) return;
    setBusyId(row.id);
    const { data, error } = await supabase.from('ai_subscriptions').update({ status: 'cancelled' }).eq('id', row.id).select('id');
    setBusyId(null);
    if (error) { toast('تعذّر إلغاء الاشتراك', 'error', error); return; }
    if (!data?.length) { toast('الاشتراك ماتلغاش (ممكن الصلاحية ترفض). حدّث الصفحة وجرّب تاني', 'error'); return; }
    logAction({
      adminId: me?.id,
      adminName: me?.name || 'أدمن',
      action: 'ai_sub_cancel',
      targetType: 'ai_subscription',
      targetId: row.id,
      details: `إلغاء اشتراك: ${row.student_name || row.user_id} · خطة "${row.plan_name}"${row.amount_paid == null ? '' : ` · مدفوع ${formatEgp(row.amount_paid)}`}`,
    });
    toast('اتلغى الاشتراك');
    load();
  };

  const renew = (row) => setDialog({ initial: { student: { id: row.user_id, name: row.student_name, email: '' }, planId: row.plan_id } });
  const saved = () => { setDialog(null); load(); };

  if (loading) return <Spinner />;

  if (missing) {
    return (
      <div>
        <PageHeader eyebrow="المساعد الذكي" title="اشتراكات بو" />
        <div className="card p-6 max-w-xl">
          <p className="font-messiri font-bold mb-1">جداول الاشتراكات لسه ماتعملتش</p>
          <p className="text-sm text-muted">
            شغّل <span className="font-mono" dir="ltr">sql/supabase_ai_plans.sql</span> في Supabase SQL Editor (بعد ملف حالة الموديلات)، وبعدين ارجع هنا.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="المساعد الذكي"
        title="اشتراكات بو"
        action={!dialog && (
          <button type="button" onClick={() => setDialog({})} disabled={plans.length === 0} className="btn-primary">+ تفعيل اشتراك</button>
        )}
      />

      {plans.length === 0 && (
        <div className="bg-amber/10 border border-amber/40 rounded-xl p-3 mb-5 text-sm max-w-2xl">
          مفيش خطط لسه. <Link to="/ai-plans" className="text-accent-dark font-semibold hover:underline">أضف خطة</Link> الأول عشان تقدر تفعّل اشتراك.
        </div>
      )}

      {dialog && (
        <SubscriptionDialog plans={plans} subscriptions={rows} initial={dialog.initial} onClose={() => setDialog(null)} onSaved={saved} />
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTab(t.key); setLimit(PAGE_SIZE); }}
            aria-pressed={tab === t.key}
            className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border transition ${
              tab === t.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-surface-line hover:text-ink'
            }`}
          >
            {t.label} <span className={tab === t.key ? 'text-white/70' : 'text-muted/70'}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setLimit(PAGE_SIZE); }}
        placeholder="بحث باسم الطالب"
        aria-label="بحث باسم الطالب"
        className="input-field max-w-xs mb-5"
      />

      {visible.length === 0 ? (
        <EmptyState
          icon="◇"
          title={query.trim() ? 'مفيش نتايج للبحث ده' : 'مفيش اشتراكات في التبويب ده'}
          hint={!query.trim() && tab === 'active' ? 'فعّل أول اشتراك بعد ما طالب يدفع.' : undefined}
        />
      ) : (
        <>
          <ul className="space-y-3">
            {visible.slice(0, limit).map((row) => {
              const [tone, label] = STATUS_STAMP[row.effective_status] || ['ink', row.effective_status];
              const left = daysLeft(row.ends_at);
              const soon = isExpiringSoon(row);
              return (
                <li key={row.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <Link to={`/accounts/${row.user_id}`} className="font-semibold hover:underline">{row.student_name || 'من غير اسم'}</Link>
                      <p className="text-sm text-muted">خطة "{row.plan_name}" · {row.daily_limit} رسالة/يوم</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {soon && <Stamp tone="amber">باقي {left} يوم</Stamp>}
                      <Stamp tone={tone}>{label}</Stamp>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 text-sm">
                    <div><dt className="text-[11px] text-muted font-semibold">البداية</dt><dd>{formatCairoDate(row.starts_at)}</dd></div>
                    <div><dt className="text-[11px] text-muted font-semibold">النهاية</dt><dd>{row.ends_at ? formatCairoDate(row.ends_at) : 'مفتوح'}</dd></div>
                    <div><dt className="text-[11px] text-muted font-semibold">المدفوع</dt><dd>{row.amount_paid == null ? '—' : formatEgp(row.amount_paid)}</dd></div>
                    <div><dt className="text-[11px] text-muted font-semibold">فعّله</dt><dd className="truncate">{admins[row.activated_by] || '—'}</dd></div>
                  </dl>
                  {row.payment_note && <p className="text-xs text-muted mt-2 break-words" dir="auto">{row.payment_note}</p>}

                  <div className="flex items-center gap-2 flex-wrap mt-3">
                    {(row.effective_status === 'active' || row.effective_status === 'expired') && (
                      <button type="button" onClick={() => renew(row)} className="btn-ghost !px-3 !py-1.5 text-xs">تجديد</button>
                    )}
                    {(row.effective_status === 'active' || row.effective_status === 'scheduled') && (
                      <button type="button" disabled={busyId === row.id} onClick={() => cancel(row)} className="text-xs text-coral-dark font-semibold hover:underline mr-auto">
                        إلغاء الاشتراك
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {visible.length > limit && (
            <button type="button" onClick={() => setLimit((n) => n + PAGE_SIZE)} className="btn-ghost mt-4">
              عرض المزيد ({visible.length - limit})
            </button>
          )}
        </>
      )}
    </div>
  );
}
