import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { EmptyState, PageHeader, Spinner, Stamp, useConfirm, useToast } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import PlanDialog from '../components/ai/PlanDialog';
import { logAction } from '../lib/audit';
import { fetchAll } from '../lib/fetchAll';
import { isMissingRelation } from '../lib/clientErrors';
import { formatEgp, planDeleteMessage, reorderedPlans } from '../lib/aiPlans';

// خطط بو: الحد اليومي والمدة والسعر وموديلات الخطة. التطبيق بيعرض الخطة المفعّلة بس.
// مفيش مسح لخطة عليها اشتراكات (السيرفر بيرفض)، الإخفاء هو البديل والمشتركين مبيتأثروش.
export default function AiPlans() {
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [plans, setPlans] = useState([]);
  const [subscribers, setSubscribers] = useState({});
  const [dialog, setDialog] = useState(null); // null | { plan? }
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [planRes, subRes] = await Promise.all([
      supabase.from('ai_plans').select('*').order('sort_order').order('id'),
      fetchAll(() => supabase.from('ai_subscriptions_view').select('id, plan_id').eq('effective_status', 'active').order('id')),
    ]);
    const failure = planRes.error || subRes.error;
    if (failure) {
      if (isMissingRelation(failure)) { setMissing(true); setLoading(false); return; }
      toast('تعذّر تحميل الخطط', 'error', failure);
      setLoading(false);
      return;
    }
    setMissing(false);
    setPlans(planRes.data || []);
    const counts = {};
    (subRes.data || []).forEach((s) => { counts[s.plan_id] = (counts[s.plan_id] || 0) + 1; });
    setSubscribers(counts);
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const audit = (action, plan, details) =>
    logAction({ adminId: me?.id, adminName: me?.name || 'أدمن', action, targetType: 'ai_plan', targetId: plan.id, details });

  const toggleActive = async (plan) => {
    setBusyId(plan.id);
    const next = !plan.is_active;
    const { data, error } = await supabase.from('ai_plans').update({ is_active: next }).eq('id', plan.id).select('id');
    setBusyId(null);
    if (error) { toast('تعذّر تغيير ظهور الخطة', 'error', error); return; }
    if (!data?.length) { toast('الخطة ماتغيّرتش (ممكن الصلاحية ترفض). حدّث الصفحة وجرّب تاني', 'error'); return; }
    audit('ai_plan_toggle', plan, `${next ? 'إظهار' : 'إخفاء'} خطة "${plan.name}"`);
    toast(next ? 'الخطة بقت ظاهرة للطلاب' : 'الخطة اتخفت (المشتركين فيها مبيتأثروش)');
    load();
  };

  const move = async (index, delta) => {
    const updates = reorderedPlans(plans, index, delta);
    if (updates.length === 0) return;
    setBusyId(plans[index].id);
    const results = await Promise.all(updates.map((u) => supabase.from('ai_plans').update({ sort_order: u.sort_order }).eq('id', u.id)));
    setBusyId(null);
    const failed = results.find((r) => r.error);
    if (failed) { toast('تعذّر تغيير الترتيب', 'error', failed.error); load(); return; }
    audit('ai_plan_reorder', plans[index], `تحريك خطة "${plans[index].name}" ${delta < 0 ? 'لفوق' : 'لتحت'}`);
    load();
  };

  const remove = async (plan) => {
    const subs = subscribers[plan.id] || 0;
    const warning = subs > 0 ? ` عليها ${subs} اشتراك فعّال، والمسح هيترفض. الأفضل تخفيها.` : '';
    const ok = await confirm(`مسح خطة "${plan.name}" نهائيًا؟${warning}`, { danger: true, confirmLabel: 'امسح' });
    if (!ok) return;
    setBusyId(plan.id);
    const { data, error } = await supabase.from('ai_plans').delete().eq('id', plan.id).select('id');
    setBusyId(null);
    if (error) {
      const friendly = planDeleteMessage(error);
      toast(friendly || 'تعذّر مسح الخطة', 'error', friendly ? undefined : error);
      return;
    }
    if (!data?.length) { toast('الخطة ماتمسحتش (ممكن الصلاحية ترفض)', 'error'); return; }
    audit('ai_plan_delete', plan, `مسح خطة "${plan.name}"`);
    toast('اتمسحت الخطة');
    load();
  };

  const closeDialog = () => setDialog(null);
  const saved = () => { setDialog(null); load(); };
  const nextOrder = plans.reduce((m, p) => Math.max(m, p.sort_order || 0), 0) + 1;

  if (loading) return <Spinner />;

  if (missing) {
    return (
      <div>
        <PageHeader eyebrow="المساعد الذكي" title="خطط بو" />
        <div className="card p-6 max-w-xl">
          <p className="font-messiri font-bold mb-1">جداول الخطط لسه ماتعملتش</p>
          <p className="text-sm text-muted">
            شغّل <span className="font-mono" dir="ltr">sql/supabase_ai_model_state.sql</span> ثم{' '}
            <span className="font-mono" dir="ltr">sql/supabase_ai_plans.sql</span> في Supabase SQL Editor، وبعدين ارجع هنا.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="المساعد الذكي"
        title="خطط بو"
        action={!dialog && <button type="button" onClick={() => setDialog({})} className="btn-primary">+ خطة جديدة</button>}
      />

      <p className="text-sm text-muted mb-5 max-w-2xl">
        الطالب بيشترك في خطة (رسايل أكتر في اليوم، وممكن موديل أقوى) وأنت بتفعّل اشتراكه من{' '}
        <Link to="/ai-subscriptions" className="text-accent-dark font-semibold hover:underline">صفحة الاشتراكات</Link> بعد ما يدفع.
        اللي بتغيّره هنا بيوصل التطبيق من غير تحديث.
      </p>

      {dialog && <PlanDialog plan={dialog.plan} nextOrder={nextOrder} onClose={closeDialog} onSaved={saved} />}

      {plans.length === 0 ? (
        <EmptyState icon="◇" title="مفيش خطط لسه" hint="أضف أول خطة، وبعدها فعّل بيها اشتراكات الطلاب." />
      ) : (
        <ul className="space-y-3">
          {plans.map((plan, i) => {
            const subs = subscribers[plan.id] || 0;
            return (
              <li key={plan.id} className={`card p-4 ${plan.is_active ? '' : 'opacity-75'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-messiri font-bold text-lg">{plan.name}</p>
                      {plan.is_active ? <Stamp tone="forest">ظاهرة</Stamp> : <Stamp tone="amber">مخفية</Stamp>}
                    </div>
                    {plan.description && <p className="text-sm text-muted mt-0.5" dir="auto">{plan.description}</p>}
                  </div>
                  <p className="font-messiri font-bold text-lg shrink-0">{plan.price_egp == null ? 'من غير سعر' : formatEgp(plan.price_egp)}</p>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 text-sm">
                  <div><dt className="text-[11px] text-muted font-semibold">الحد اليومي</dt><dd>{plan.daily_limit} رسالة</dd></div>
                  <div><dt className="text-[11px] text-muted font-semibold">المدة</dt><dd>{plan.duration_days ? `${plan.duration_days} يوم` : 'بدون مدة'}</dd></div>
                  <div><dt className="text-[11px] text-muted font-semibold">مشتركين فعّالين</dt><dd>{subs}</dd></div>
                  <div className="min-w-0">
                    <dt className="text-[11px] text-muted font-semibold">الموديلات</dt>
                    <dd className="truncate font-mono text-xs pt-0.5" dir="ltr" title={(plan.models || []).join(', ')}>
                      {plan.models?.length ? plan.models.join(' → ') : <span className="font-cairo text-sm text-muted" dir="rtl">العامة</span>}
                    </dd>
                  </div>
                </dl>

                <div className="flex items-center gap-2 flex-wrap mt-4">
                  <button type="button" disabled={busyId === plan.id} onClick={() => setDialog({ plan })} className="btn-ghost !px-3 !py-1.5 text-xs">تعديل</button>
                  <button type="button" disabled={busyId === plan.id} onClick={() => toggleActive(plan)} className="btn-ghost !px-3 !py-1.5 text-xs">
                    {plan.is_active ? 'إخفاء' : 'إظهار'}
                  </button>
                  <button type="button" disabled={busyId === plan.id || i === 0} onClick={() => move(i, -1)} aria-label={`قدّم ${plan.name}`} className="btn-ghost !px-3 !py-1.5 text-xs">↑</button>
                  <button type="button" disabled={busyId === plan.id || i === plans.length - 1} onClick={() => move(i, 1)} aria-label={`أخّر ${plan.name}`} className="btn-ghost !px-3 !py-1.5 text-xs">↓</button>
                  <button type="button" disabled={busyId === plan.id} onClick={() => remove(plan)} className="text-xs text-coral-dark font-semibold hover:underline mr-auto">مسح</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
