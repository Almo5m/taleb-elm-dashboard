import { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useToast } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { MAX_PLAN_MODELS } from '../../lib/aiModels';
import { PLAN_LIMITS, emptyPlanForm, planChanges, planToForm, validatePlanForm } from '../../lib/aiPlans';
import ModelChainEditor from './ModelChainEditor';

// إضافة خطة أو تعديلها. الفحص من lib/aiPlans (نفس قيود الجدول).
export default function PlanDialog({ plan, nextOrder, onClose, onSaved }) {
  const toast = useToast();
  const me = useAppUser();
  const editing = !!plan;
  const [form, setForm] = useState(editing ? planToForm(plan) : emptyPlanForm());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (patch) => { setForm((prev) => ({ ...prev, ...patch })); setError(''); };

  const save = async () => {
    const { error: problem, payload } = validatePlanForm(form);
    if (problem) { setError(problem); return; }
    setSaving(true);
    const { error: err } = editing
      ? await supabase.from('ai_plans').update(payload).eq('id', plan.id)
      : await supabase.from('ai_plans').insert({ ...payload, sort_order: nextOrder });
    setSaving(false);
    if (err) { toast(editing ? 'تعذّر تعديل الخطة' : 'تعذّر إضافة الخطة', 'error', err); return; }
    logAction({
      adminId: me?.id,
      adminName: me?.name || 'أدمن',
      action: editing ? 'ai_plan_edit' : 'ai_plan_add',
      targetType: 'ai_plan',
      targetId: editing ? plan.id : null,
      details: editing
        ? { plan: payload.name, changes: planChanges(plan, payload) }
        : `إضافة خطة "${payload.name}" (${payload.daily_limit} رسالة/يوم)`,
    });
    toast(editing ? 'اتعدّلت الخطة' : 'اتضافت الخطة');
    onSaved();
  };

  return (
    <div className="card p-5 mb-5 border-accent/40">
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="font-messiri font-bold">{editing ? `تعديل خطة: ${plan.name}` : 'إضافة خطة'}</p>
        <button type="button" onClick={onClose} className="btn-ghost !px-3 !py-1.5 text-sm shrink-0">إلغاء</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="plan-name">اسم الخطة</label>
          <input id="plan-name" value={form.name} maxLength={PLAN_LIMITS.nameMax} onChange={(e) => set({ name: e.target.value })} className="input-field mt-1" />
        </div>
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="plan-price">السعر بالجنيه (للعرض بس)</label>
          <input id="plan-price" type="number" min="0" step="0.01" value={form.price_egp} onChange={(e) => set({ price_egp: e.target.value })} className="input-field mt-1" />
        </div>
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="plan-daily">الحد اليومي (رسالة)</label>
          <input id="plan-daily" type="number" min={PLAN_LIMITS.dailyMin} max={PLAN_LIMITS.dailyMax} value={form.daily_limit} onChange={(e) => set({ daily_limit: e.target.value })} className="input-field mt-1" />
        </div>
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="plan-days">المدة بالأيام</label>
          <input id="plan-days" type="number" min={PLAN_LIMITS.durationMin} max={PLAN_LIMITS.durationMax} value={form.duration_days} onChange={(e) => set({ duration_days: e.target.value })} className="input-field mt-1" />
          <p className="text-[11px] text-muted mt-1">فاضي = بدون مدة (مفتوحة)</p>
        </div>
      </div>

      <label className="text-xs text-muted font-semibold" htmlFor="plan-desc">سطر وصف للطالب</label>
      <input id="plan-desc" value={form.description} maxLength={PLAN_LIMITS.descriptionMax} onChange={(e) => set({ description: e.target.value })} className="input-field mt-1 mb-4" />

      <p className="text-xs text-muted font-semibold mb-1" id="plan-models-label">موديلات الخطة (اختياري)</p>
      <p className="text-[11px] text-muted mb-2">
        بتتجرّب الأول بالترتيب، وبعدها السلسلة العامة كاحتياطي. فاضي = بيستخدم الموديلات العامة بس. أقصى عدد {MAX_PLAN_MODELS}.
      </p>
      <ModelChainEditor
        id="plan-models"
        value={form.models}
        onChange={(models) => set({ models })}
        max={MAX_PLAN_MODELS}
        emptyText="مفيش موديلات خاصة، الخطة بتستخدم السلسلة العامة."
      />

      <label className="flex items-center gap-3 mt-4 cursor-pointer">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="w-5 h-5 accent-coral" />
        <span className="text-sm font-semibold">ظاهرة للطلاب في قايمة الخطط</span>
      </label>

      {error && <p className="text-sm text-coral-dark font-semibold mt-3" role="alert">{error}</p>}
      <button type="button" onClick={save} disabled={saving} className="btn-primary mt-4">
        {saving ? 'جارِ الحفظ...' : editing ? 'حفظ التعديل' : 'إضافة الخطة'}
      </button>
    </div>
  );
}
