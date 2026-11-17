import { useMemo, useState } from 'react';
import { Stamp } from '../UI';
import { coverage } from '../../lib/catalog';

// تغطية المنهج: لكل نظام وصف، كام مادة فيها دروس ظاهرة من الإجمالي (نسبة)
export default function CoverageCard({ subjects, stats }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => coverage(subjects, stats), [subjects, stats]);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const covered = rows.reduce((s, r) => s + r.covered, 0);

  return (
    <div className="card p-4 mb-5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 text-right" aria-expanded={open}>
        <span className="font-messiri font-bold">تغطية المنهج</span>
        <span className="flex items-center gap-2 text-xs text-muted shrink-0">
          <Stamp tone={covered === total && total > 0 ? 'forest' : 'amber'}>{covered} من {total} مادة فيها دروس</Stamp>
          <span>{open ? '▲' : '▼'}</span>
        </span>
      </button>
      {open && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...new Set(rows.map((r) => r.system))].map((system) => (
            <div key={system} className="bg-surface rounded-xl p-3">
              <p className="font-semibold text-sm mb-2">{system}</p>
              <ul className="space-y-2.5">
                {rows.filter((r) => r.system === system).map((r) => (
                  <li key={r.grade}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 break-words text-muted">{r.grade.replace('الصف ', '').replace(' الثانوي', '')}</span>
                      <span className="font-semibold shrink-0">{r.covered} / {r.total} <span className="text-muted font-normal">({r.pct}%)</span></span>
                    </div>
                    <div className="h-1.5 bg-white rounded-full mt-1 overflow-hidden" role="progressbar" aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full bg-accent-dark rounded-full" style={{ width: `${r.pct}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
