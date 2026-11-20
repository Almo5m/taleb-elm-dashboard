import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useToast } from '../UI';
import { isMissingRelation } from '../../lib/clientErrors';
import { fetchSetting } from '../../lib/appSettings';
import { DAY_MS, EXPIRING_DAYS, cairoDayStartIso, estimateCost, formatEgp, lastMonths, monthlySeries } from '../../lib/aiPlans';

const MONTHS = 6;
const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthName = (key) => MONTH_NAMES[Number(key.slice(5, 7)) - 1];

function Figure({ label, value, tone = '', hint }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted font-semibold">{label}</p>
      <p className={`font-messiri font-extrabold text-xl truncate ${tone}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

// أعمدة دخل وتكلفة لآخر ٦ شهور (CSS بس، من غير مكتبة رسم)
function MonthBars({ series }) {
  const max = Math.max(1, ...series.flatMap((m) => [m.revenue, m.cost || 0]));
  return (
    <div className="grid grid-cols-6 gap-2 items-end h-28" role="img" aria-label="دخل وتكلفة بو لآخر ستة شهور">
      {series.map((m) => (
        <div key={m.month} className="flex flex-col items-center justify-end h-full min-w-0">
          <div className="flex items-end gap-1 flex-1 w-full justify-center">
            <div className="w-3 rounded-t bg-accent" style={{ height: `${(m.revenue / max) * 100}%`, minHeight: m.revenue > 0 ? 3 : 0 }} title={`دخل ${formatEgp(m.revenue)}`} />
            <div className="w-3 rounded-t bg-amber" style={{ height: `${((m.cost || 0) / max) * 100}%`, minHeight: m.cost > 0 ? 3 : 0 }} title={m.cost === null ? 'التكلفة مش متحسبة' : `تكلفة ${formatEgp(m.cost)}`} />
          </div>
          <p className="text-[10px] text-muted mt-1.5 truncate max-w-full">{monthName(m.month)}</p>
        </div>
      ))}
    </div>
  );
}

// كارت الرئيسية: اشتراكات بو (فعّالة وبتنتهي قريب) + الدخل والتكلفة التقديرية والصافي + طلبات بو النهاردة.
export default function AiSubscriptionsCard() {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, missing: false, data: null });

  useEffect(() => {
    let active = true;
    (async () => {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const soonIso = new Date(now + EXPIRING_DAYS * DAY_MS).toISOString();
      const dayStart = cairoDayStartIso(now);
      const head = { count: 'exact', head: true };

      const [activeRes, soonRes, revenueRes, tokensRes, pricingRes, eventsToday, logsToday] = await Promise.all([
        supabase.from('ai_subscriptions_view').select('id', head).eq('effective_status', 'active'),
        supabase.from('ai_subscriptions_view').select('id', head).eq('effective_status', 'active').gt('ends_at', nowIso).lte('ends_at', soonIso),
        supabase.from('ai_revenue_monthly').select('*'),
        supabase.from('ai_token_usage_monthly').select('*'),
        fetchSetting('ai_pricing'),
        supabase.from('ai_usage_events').select('id', head).gte('created_at', dayStart),
        supabase.from('ai_chat_logs').select('id', head).gte('created_at', dayStart),
      ]);
      if (!active) return;

      const failure = activeRes.error || soonRes.error || revenueRes.error || tokensRes.error || eventsToday.error;
      if (failure) {
        if (isMissingRelation(failure)) { setState({ loading: false, missing: true, data: null }); return; }
        toast('تعذّر تحميل كارت اشتراكات بو', 'error', failure);
        setState({ loading: false, missing: false, data: null });
        return;
      }
      // فشل قراءة الأسعار أو سجل الأسئلة مبيوقفش الكارت (بيظهروا ناقصين بس)
      const pricing = pricingRes.error ? null : pricingRes.value;
      const months = lastMonths(MONTHS, now);
      const series = monthlySeries(months, revenueRes.data || [], tokensRes.data || [], pricing);
      const thisMonth = series[series.length - 1];
      const cost = estimateCost((tokensRes.data || []).filter((r) => r.month === thisMonth.month), pricing);
      const asked = logsToday.error ? null : logsToday.count ?? 0;
      const answered = eventsToday.count ?? 0;

      setState({
        loading: false,
        missing: false,
        data: {
          activeCount: activeRes.count ?? 0,
          soonCount: soonRes.count ?? 0,
          series,
          thisMonth,
          cost,
          pricingFailed: !!pricingRes.error,
          asked,
          answered,
        },
      });
    })();
    return () => { active = false; };
  }, [toast]);

  const { loading, missing, data } = state;

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <p className="font-messiri font-bold">اشتراكات بو</p>
        <div className="flex items-center gap-3 text-xs font-semibold">
          <Link to="/ai?tab=subscriptions" className="text-muted hover:text-inktext">الاشتراكات ←</Link>
          <Link to="/ai?tab=plans" className="text-muted hover:text-inktext">الخطط ←</Link>
        </div>
      </div>
      <p className="text-xs text-muted mb-5">الدخل والتكلفة التقديرية لاستهلاك الموديلات</p>

      {loading ? (
        <p className="text-sm text-muted">جارِ التحميل...</p>
      ) : missing ? (
        <p className="text-sm text-muted">شغّل <span className="font-mono" dir="ltr">sql/supabase_ai_plans.sql</span> في Supabase عشان الكارت ده يشتغل.</p>
      ) : !data ? (
        <p className="text-sm text-coral-dark">تعذّر تحميل بيانات الاشتراكات</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-5">
            <Figure label="اشتراكات فعّالة" value={data.activeCount.toLocaleString('en-US')} />
            <Figure
              label={`بتنتهي خلال ${EXPIRING_DAYS} أيام`}
              value={data.soonCount.toLocaleString('en-US')}
              tone={data.soonCount > 0 ? 'text-amber-dark' : ''}
              hint={data.soonCount > 0 ? 'كلّمهم للتجديد' : undefined}
            />
            <Figure label="الدخل هذا الشهر" value={formatEgp(data.thisMonth.revenue)} tone="text-forest" />
            <Figure label="التكلفة التقديرية" value={data.cost.egp === null ? '—' : formatEgp(data.cost.egp)} />
            <Figure
              label="الصافي"
              value={data.thisMonth.net === null ? '—' : formatEgp(data.thisMonth.net)}
              tone={data.thisMonth.net !== null && data.thisMonth.net < 0 ? 'text-coral-dark' : ''}
            />
          </div>

          {(data.cost.unpriced.length > 0 || !data.cost.hasRate || data.pricingFailed) && (
            <p className="text-xs text-amber-dark bg-amber/10 border border-amber/30 rounded-lg px-2.5 py-2 mb-4">
              {data.pricingFailed
                ? 'تعذّر تحميل أسعار الموديلات، فالتكلفة مش ظاهرة.'
                : !data.cost.hasRate
                  ? 'حدّد سعر الدولار بالجنيه من الإعدادات عشان التكلفة تتحسب.'
                  : <>موديلات غير مسعّرة: <span className="font-mono" dir="ltr">{data.cost.unpriced.join(', ')}</span>. التكلفة ناقصة لحد ما تضيف سعرها.</>}{' '}
              <Link to="/ai?tab=settings" className="font-semibold underline">الإعدادات</Link>
            </p>
          )}

          <MonthBars series={data.series} />
          <div className="flex items-center gap-4 mt-3 text-[11px] text-muted">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent" /> دخل</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber" /> تكلفة تقديرية</span>
          </div>

          {data.asked !== null && (
            <p className="text-xs text-muted mt-4 pt-4 border-t border-surface-line">
              طلبات بو النهاردة: <span className="font-semibold text-inktext">{data.asked.toLocaleString('en-US')}</span>، اتجاوب منها{' '}
              <span className="font-semibold text-inktext">{data.answered.toLocaleString('en-US')}</span>
              {data.asked > data.answered && (
                <>، وماتجاوبش <span className="font-semibold text-coral-dark">{(data.asked - data.answered).toLocaleString('en-US')}</span> (رصيد خلص أو خطأ). تقريبي.</>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
