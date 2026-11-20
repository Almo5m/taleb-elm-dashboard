import { useMemo, useState } from 'react';
import { BULK_ACTIONS, BULK_SCOPES, planBulkAction, scopeTargets } from '../lib/bulk';

// عملية واحدة على مجموعة طلاب: تختار النطاق (المحدَّدين / المطابقين للفلتر / كل الطلاب) والإجراء،
// وبتشوف قبل التنفيذ هيتنفّذ على كام وهيتخطّى كام. مبتلمسش الأدمن ولا المشرفين.
export default function BulkActionsPanel({ profiles, filteredIds, selected, aiAccess, busy, onRun }) {
  const [scope, setScope] = useState('filtered');
  const [action, setAction] = useState('ai_off');

  const counts = useMemo(
    () => Object.fromEntries(BULK_SCOPES.map((s) => [s.key, scopeTargets(profiles, s.key, { selected, filteredIds }).length])),
    [profiles, selected, filteredIds]
  );
  // لو النطاق المختار "المحدَّدين" ومفيش تحديد، نرجع للفلتر تلقائيًا
  const effectiveScope = scope === 'selected' && counts.selected === 0 ? 'filtered' : scope;
  const plan = useMemo(() => {
    const ids = scopeTargets(profiles, effectiveScope, { selected, filteredIds });
    return planBulkAction(action, ids, profiles, aiAccess);
  }, [profiles, effectiveScope, selected, filteredIds, action, aiAccess]);

  const actionMeta = BULK_ACTIONS.find((a) => a.key === action);
  const scopeLabel = BULK_SCOPES.find((s) => s.key === effectiveScope).label;

  return (
    <div className="card p-4 mb-4">
      <p className="font-messiri font-bold mb-0.5">عملية جماعية على الطلاب</p>
      <p className="text-xs text-muted mb-3">للطلاب بس، مش الأدمن ولا المشرفين. اختار النطاق والإجراء وهتشوف العدد قبل التنفيذ.</p>

      <div className="flex flex-wrap gap-2 mb-3" role="radiogroup" aria-label="نطاق العملية">
        {BULK_SCOPES.map((s) => {
          const disabled = s.key === 'selected' && counts.selected === 0;
          const active = effectiveScope === s.key;
          return (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => setScope(s.key)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border transition disabled:opacity-40 ${
                active ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-surface-line hover:text-ink'
              }`}
            >
              {s.label} <span className={active ? 'text-white/70' : 'text-muted/70'}>{counts[s.key]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <select value={action} onChange={(e) => setAction(e.target.value)} className="input-field sm:w-80" aria-label="الإجراء">
          {BULK_ACTIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        <button
          type="button"
          disabled={busy || plan.ids.length === 0}
          onClick={() => onRun({ action, ids: plan.ids, skipped: plan.skipped, scopeLabel, label: actionMeta.label, danger: actionMeta.danger })}
          className={`${actionMeta.danger ? 'btn-danger' : 'btn-primary'} !px-4 !py-2 text-sm`}
        >
          {busy ? 'جارِ التنفيذ...' : `نفّذ على ${plan.ids.length.toLocaleString('en-US')} طالب`}
        </button>
      </div>
      <p className="text-xs text-muted mt-2">
        {plan.ids.length === 0
          ? 'مفيش حد محتاج الإجراء ده في النطاق ده.'
          : plan.skipped > 0
            ? `هيتخطّى ${plan.skipped.toLocaleString('en-US')} لأنهم في الحالة دي أصلًا.`
            : 'مفيش حد هيتخطّى.'}
      </p>
    </div>
  );
}
