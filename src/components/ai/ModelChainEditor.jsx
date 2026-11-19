import { useState } from 'react';
import { MAX_CHAIN, modelNameProblem, moveItem, normalizeModelName } from '../../lib/aiModels';

// قايمة موديلات مرتبة (البدائل في الإعدادات، وموديلات الخطة): إضافة وحذف وتحريك بالأسهم.
// الترتيب = الأولوية. الفحص هنا بيطابق فحص الدالة، فاللي يتضاف مقبول عند السيرفر.
export default function ModelChainEditor({ id, value, onChange, primary = '', max = MAX_CHAIN - 1, emptyText }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const add = () => {
    const name = normalizeModelName(draft);
    const problem =
      modelNameProblem(draft) ||
      (primary && name === normalizeModelName(primary) ? 'ده الموديل الأساسي، مينفعش يتكرر' : null) ||
      (value.includes(name) ? 'الموديل ده متضاف قبل كده' : null) ||
      (value.length >= max ? `أقصى عدد ${max} موديل في القايمة دي` : null);
    if (problem) { setError(problem); return; }
    onChange([...value, name]);
    setDraft('');
    setError('');
  };

  const onKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    add();
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(''); }}
          onKeyDown={onKeyDown}
          placeholder="gemini-3.5-flash-lite"
          dir="ltr"
          className="input-field flex-1 text-left"
        />
        <button type="button" onClick={add} className="btn-ghost shrink-0">إضافة</button>
      </div>
      {error && <p className="text-[11px] text-coral-dark font-semibold mt-1" role="alert">{error}</p>}

      {value.length === 0 ? (
        <p className="text-xs text-muted mt-2">{emptyText}</p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {value.map((name, i) => (
            <li key={name} className="flex items-center gap-2 bg-surface rounded-xl px-3 py-1.5">
              <span className="w-5 text-center text-xs text-muted font-semibold shrink-0">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate text-sm font-mono" dir="ltr">{name}</span>
              <button
                type="button"
                onClick={() => onChange(moveItem(value, i, -1))}
                disabled={i === 0}
                aria-label={`قدّم ${name}`}
                className="px-1.5 text-muted hover:text-ink disabled:opacity-25 disabled:hover:text-muted"
              >↑</button>
              <button
                type="button"
                onClick={() => onChange(moveItem(value, i, 1))}
                disabled={i === value.length - 1}
                aria-label={`أخّر ${name}`}
                className="px-1.5 text-muted hover:text-ink disabled:opacity-25 disabled:hover:text-muted"
              >↓</button>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                aria-label={`احذف ${name}`}
                className="px-1.5 text-muted hover:text-coral font-bold"
              >×</button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
