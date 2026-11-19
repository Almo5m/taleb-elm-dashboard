import { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useToast } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import {
  PLAN_LIMITS, activeSubscriptionOf, formatCairoDate, formatEgp, renewalStart, toLocalInputValue, validateSubscriptionForm,
} from '../../lib/aiPlans';
import StudentPicker from './StudentPicker';

// تفعيل اشتراك لطالب بعد ما يدفع (الدفع يدوي). لو عنده اشتراك فعّال بنسأل: تجديد بعده ولا استبداله.
// الاشتراك مبيتمسحش أبدًا (سجل مالي): الإلغاء بس.
export default function SubscriptionDialog({ plans, subscriptions, initial, onClose, onSaved }) {
  const toast = useToast();
  const me = useAppUser();
  const [student, setStudent] = useState(initial?.student || null);
  const [planId, setPlanId] = useState(initial?.planId ? String(initial.planId) : '');
  const [startsAt, setStartsAt] = useState(toLocalInputValue());
  const [endsAt, setEndsAt] = useState('');
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [note, setNote] = useState('');
  const [conflict, setConflict] = useState(null); // اشتراك فعّال موجود للطالب
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const plan = plans.find((p) => String(p.id) === planId);
  const planPrice = plan?.price_egp == null ? '' : String(Number(plan.price_egp));

  // المبلغ الافتراضي سعر الخطة، لحد ما الأدمن يكتب رقمه بنفسه
  const choosePlan = (id) => {
    setPlanId(id);
    setError('');
    setConflict(null);
    const chosen = plans.find((p) => String(p.id) === id);
    if (!amountTouched) setAmount(chosen?.price_egp == null ? '' : String(Number(chosen.price_egp)));
  };

  const audit = (action, targetId, details) =>
    logAction({ adminId: me?.id, adminName: me?.name || 'أدمن', action, targetType: 'ai_subscription', targetId, details });

  // mode: new = تفعيل عادي | renew = يبدأ عند نهاية الحالي | replace = يلغي الحالي ويبدأ دلوقتي
  const submit = async (mode = 'new') => {
    const current = student ? activeSubscriptionOf(subscriptions, student.id) : null;
    const form = { userId: student?.id, planId, startsAt, endsAt, amount, note };
    if (mode === 'renew') form.startsAt = renewalStart(current);

    const { error: problem, payload, plan: chosen } = validateSubscriptionForm(form, plans);
    if (problem) { setError(problem); setConflict(null); return; }
    if (mode === 'new' && current) { setConflict(current); setError(''); return; }

    setSaving(true);
    const { data, error: insertError } = await supabase
      .from('ai_subscriptions')
      .insert({ ...payload, activated_by: me?.id ?? null })
      .select('id')
      .single();
    if (insertError) {
      setSaving(false);
      toast('تعذّر تفعيل الاشتراك', 'error', insertError);
      return;
    }

    const label = `${student.name || student.email} · خطة "${chosen.name}"${payload.amount_paid == null ? '' : ` · ${formatEgp(payload.amount_paid)}`}`;
    audit(mode === 'renew' ? 'ai_sub_renew' : 'ai_sub_activate', data.id, `${mode === 'renew' ? 'تجديد' : 'تفعيل'} اشتراك: ${label}`);

    // الاستبدال: الجديد اتكتب الأول، فلو إلغاء القديم فشل الطالب مش بيفقد بو (السيرفر بيطبّق أكبر خطة)
    if (mode === 'replace' && current) {
      const { data: cancelled, error: cancelError } = await supabase
        .from('ai_subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', current.id)
        .select('id');
      if (cancelError || !cancelled?.length) {
        setSaving(false);
        toast('الاشتراك الجديد اتفعّل، لكن إلغاء القديم فشل. ألغيه من القايمة', 'error', cancelError || undefined);
        onSaved();
        return;
      }
      audit('ai_sub_cancel', current.id, `إلغاء اشتراك قديم (استبدال): ${student.name || student.email} · خطة "${current.plan_name}"`);
    }

    setSaving(false);
    toast('تم تفعيل الاشتراك');
    onSaved();
  };

  return (
    <div className="card p-5 mb-5 border-accent/40">
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="font-messiri font-bold">تفعيل اشتراك</p>
        <button type="button" onClick={onClose} className="btn-ghost !px-3 !py-1.5 text-sm shrink-0">إلغاء</button>
      </div>

      <p className="text-xs text-muted font-semibold mb-1">الطالب</p>
      <div className="mb-4">
        <StudentPicker value={student} onChange={(s) => { setStudent(s); setConflict(null); setError(''); }} disabled={saving} />
      </div>

      <label className="text-xs text-muted font-semibold" htmlFor="sub-plan">الخطة</label>
      <select id="sub-plan" value={planId} onChange={(e) => choosePlan(e.target.value)} className="input-field mt-1 mb-4">
        <option value="">اختار الخطة</option>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.daily_limit} رسالة/يوم{p.price_egp == null ? '' : ` · ${formatEgp(p.price_egp)}`}{p.is_active ? '' : ' (مخفية)'}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="sub-start">البداية</label>
          <input id="sub-start" type="datetime-local" value={startsAt} onChange={(e) => { setStartsAt(e.target.value); setError(''); }} className="input-field mt-1" />
        </div>
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="sub-end">النهاية</label>
          <input id="sub-end" type="datetime-local" value={endsAt} onChange={(e) => { setEndsAt(e.target.value); setError(''); }} className="input-field mt-1" />
          <p className="text-[11px] text-muted mt-1">
            {plan?.duration_days ? `فاضي = تتحسب تلقائيًا (${plan.duration_days} يوم من البداية)` : 'فاضي = اشتراك مفتوح من غير نهاية'}
          </p>
        </div>
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="sub-amount">المبلغ المدفوع (جنيه)</label>
          <input
            id="sub-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setAmountTouched(true); setError(''); }}
            className="input-field mt-1"
          />
          {plan && planPrice !== '' && amount !== planPrice && (
            <p className="text-[11px] text-amber-dark mt-1">سعر الخطة {formatEgp(plan.price_egp)}</p>
          )}
        </div>
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="sub-note">ملاحظة الدفع</label>
          <input
            id="sub-note"
            value={note}
            maxLength={PLAN_LIMITS.noteMax}
            onChange={(e) => { setNote(e.target.value); setError(''); }}
            placeholder="مثلًا: فودافون كاش"
            className="input-field mt-1"
          />
          <p className="text-[11px] text-muted mt-1">وسيلة الدفع بس، من غير أرقام تليفونات أو حسابات.</p>
        </div>
      </div>

      {conflict && (
        <div className="bg-amber/10 border border-amber/40 rounded-xl p-3 mt-4" role="alert">
          <p className="text-sm font-semibold mb-1">
            الطالب ده عنده اشتراك فعّال{conflict.ends_at ? ` لحد ${formatCairoDate(conflict.ends_at)}` : ' من غير نهاية'} (خطة "{conflict.plan_name}").
          </p>
          <p className="text-xs text-muted mb-3">تجدد بعده، ولا تلغي الحالي وتبدأ دلوقتي؟</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={saving || !conflict.ends_at} onClick={() => submit('renew')} className="btn-primary !px-3 !py-1.5 text-sm">
              جدّد بعد الحالي
            </button>
            <button type="button" disabled={saving} onClick={() => submit('replace')} className="btn-ghost !px-3 !py-1.5 text-sm">
              ألغِ الحالي وابدأ دلوقتي
            </button>
            <button type="button" disabled={saving} onClick={() => setConflict(null)} className="btn-ghost !px-3 !py-1.5 text-sm">رجوع</button>
          </div>
          {!conflict.ends_at && <p className="text-[11px] text-muted mt-2">الاشتراك الحالي مفتوح من غير نهاية، فمفيش حاجة تتجدد بعده. الاستبدال هو الخيار المتاح.</p>}
        </div>
      )}

      {error && <p className="text-sm text-coral-dark font-semibold mt-3" role="alert">{error}</p>}
      {!conflict && (
        <button type="button" onClick={() => submit('new')} disabled={saving} className="btn-primary mt-4">
          {saving ? 'جارِ التفعيل...' : 'تفعيل الاشتراك'}
        </button>
      )}
    </div>
  );
}
