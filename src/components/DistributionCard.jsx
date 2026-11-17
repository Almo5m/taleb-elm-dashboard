import { useMemo, useState } from 'react';
import { Stamp } from './UI';
import { SYSTEMS, distribution, divisionLabel, hasTracks } from '../lib/divisions';

// توزيع الطلاب: عدد لكل (نظام، صف، شعبة). أي توليفة مش من الجدول الرسمي بتظهر بلون مميّز
// (المفروض صفر بعد supabase_division_fix.sql).
export default function DistributionCard({ profiles, onShowInvalid }) {
  const [open, setOpen] = useState(false);
  const d = useMemo(() => distribution(profiles), [profiles]);

  return (
    <div className="card p-4 mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-right"
        aria-expanded={open}
      >
        <span className="font-messiri font-bold">توزيع الطلاب على النظام والصف والشعبة</span>
        <span className="flex items-center gap-2 text-xs text-muted shrink-0">
          {d.invalidCount > 0 ? <Stamp tone="coral">{d.invalidCount} غير مطابق</Stamp> : <Stamp tone="forest">كله مطابق</Stamp>}
          <span>{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {SYSTEMS.map((system) => {
              const rows = d.valid.filter((c) => c.system === system);
              const waiting = d.pending.filter((x) => x.system === system);
              const systemTotal = rows.reduce((s, c) => s + c.count, 0) + waiting.reduce((s, x) => s + x.count, 0);
              return (
                <div key={system} className="bg-surface rounded-xl p-3">
                  <p className="font-semibold text-sm mb-2">
                    {system} <span className="text-muted font-normal">({systemTotal})</span>
                  </p>
                  <ul className="space-y-1 text-sm">
                    {rows.map((c) => (
                      <li key={`${c.grade}|${c.track}`} className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 break-words text-muted">
                          {c.grade.replace('الصف ', '').replace(' الثانوي', '')}
                          {hasTracks(c.grade) ? ` • ${c.track}` : ''}
                        </span>
                        <span className="font-semibold shrink-0">{c.count}</span>
                      </li>
                    ))}
                    {waiting.map((x) => (
                      <li key={`w-${x.grade}`} className="flex items-baseline justify-between gap-2 text-amber-dark">
                        <span className="min-w-0 break-words">{x.grade.replace('الصف ', '').replace(' الثانوي', '')} • بدون شعبة بعد</span>
                        <span className="font-semibold shrink-0">{x.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {d.invalid.length > 0 && (
            <div className="bg-coral/5 border border-coral/30 rounded-xl p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <p className="font-semibold text-sm text-coral-dark">توليفات مش من الجدول الرسمي ({d.invalidCount} طالب)</p>
                {onShowInvalid && <button onClick={onShowInvalid} className="btn-ghost !px-3 !py-1 text-xs">اعرضهم في القايمة</button>}
              </div>
              <ul className="space-y-1 text-sm">
                {d.invalid.map((x, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words">{divisionLabel(x)}</span>
                    <span className="font-semibold shrink-0">{x.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
