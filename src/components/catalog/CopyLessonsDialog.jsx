import { useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Stamp, useToast } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { fetchAll } from '../../lib/fetchAll';
import { buildInsertRows, groupSubjects, planCopy, trackLabel } from '../../lib/catalog';

// نسخ الدروس الظاهرة لمادة (أو أكتر) تانية، من أي نظام/صف/شعبة. مفيد لأن نفس المادة بتتكرر في أكتر من نظام.
// بيتخطى المكرر (نفس العنوان بعد قص المسافات وتجاهل حالة الأحرف) وبيضيف بعد آخر ترتيب في المادة الهدف.
export default function CopyLessonsDialog({ source, sourceLessons, subjects, stats, onClose, onDone }) {
  const toast = useToast();
  const me = useAppUser();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);

  const titles = useMemo(
    () => sourceLessons.filter((l) => l.is_active).sort((a, b) => a.sort_order - b.sort_order).map((l) => l.title),
    [sourceLessons]
  );
  const groups = useMemo(() => groupSubjects(subjects, { excludeId: source.id, query }), [subjects, source.id, query]);

  const toggle = (id) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleGroup = (g) => setPicked((prev) => {
    const next = new Set(prev);
    const all = g.subjects.every((s) => next.has(s.id));
    g.subjects.forEach((s) => (all ? next.delete(s.id) : next.add(s.id)));
    return next;
  });

  const run = async () => {
    if (picked.size === 0 || titles.length === 0 || running) return;
    setRunning(true);
    const out = [];
    let firstError = null;
    for (const id of picked) {
      const target = subjects.find((s) => s.id === id);
      const { data: existing, error: readError } = await fetchAll(() => supabase.from('catalog_lessons').select('title, sort_order').eq('subject_id', id).order('id'));
      if (readError) { firstError ||= readError; out.push({ id, name: target.subject_name, error: true }); continue; }
      const plan = planCopy(titles, existing);
      if (plan.toAdd.length > 0) {
        const { error } = await supabase.from('catalog_lessons').insert(buildInsertRows(id, plan.toAdd, plan.startOrder));
        if (error) { firstError ||= error; out.push({ id, name: target.subject_name, error: true }); continue; }
      }
      out.push({ id, name: target.subject_name, system: target.system, grade: target.grade, track: target.track, added: plan.toAdd.length, skipped: plan.skipped });
    }
    setRunning(false);
    setResults(out);
    const added = out.reduce((s, r) => s + (r.added || 0), 0);
    if (firstError) toast('فشل النسخ لبعض المواد', 'error', firstError);
    logAction({
      adminId: me?.id, adminName: me?.name || 'أدمن', action: 'catalog_lessons_copy', targetType: 'catalog_subject', targetId: source.id,
      details: `نسخ ${titles.length} درس من "${source.subject_name}" إلى ${out.length} مادة (اتضاف ${added})`,
    });
    onDone();
  };

  if (results) {
    return (
      <div className="bg-surface rounded-xl p-4 mb-4">
        <p className="font-semibold mb-2">ملخص النسخ</p>
        <ul className="space-y-1.5 text-sm mb-3">
          {results.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 break-words">{r.name}</span>
              {r.error ? <Stamp tone="coral">فشل</Stamp> : <span className="text-muted">اتضاف {r.added}، اتخطى {r.skipped}</span>}
            </li>
          ))}
        </ul>
        <button onClick={onClose} className="btn-primary !px-4 !py-1.5 text-sm">تمام</button>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl p-4 mb-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="font-semibold">نسخ دروس "{source.subject_name}" لمواد تانية</p>
        <button onClick={onClose} className="btn-ghost !px-3 !py-1 text-xs shrink-0">إلغاء</button>
      </div>
      <p className="text-xs text-muted mb-3">
        هتتنسخ الدروس الظاهرة ({titles.length}) بترتيبها. اللي موجود بنفس العنوان في المادة الهدف بيتخطّى.
      </p>
      {titles.length === 0 && <p className="text-sm text-coral-dark mb-3" role="alert">مفيش دروس ظاهرة في المادة دي عشان تتنسخ.</p>}
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم المادة" className="input-field mb-3" aria-label="بحث في المواد" />
      <div className="max-h-72 overflow-y-auto space-y-3 mb-3">
        {groups.length === 0 && <p className="text-sm text-muted">مفيش مواد مطابقة.</p>}
        {groups.map((g) => (
          <div key={g.key}>
            <button type="button" onClick={() => toggleGroup(g)} className="text-xs font-semibold text-accent-dark underline underline-offset-4 mb-1">
              {g.system} • {g.grade.replace('الصف ', '').replace(' الثانوي', '')} • {trackLabel(g.track)} (تحديد الكل)
            </button>
            <ul className="space-y-1">
              {g.subjects.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} className="accent-accent-dark" />
                    <span className="min-w-0 break-words flex-1">{s.subject_name}</span>
                    <span className="text-xs text-muted shrink-0">{stats[s.id]?.visible || 0} درس</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <button onClick={run} disabled={picked.size === 0 || titles.length === 0 || running} className="btn-primary !px-5 !py-2 text-sm">
        {running ? 'بينسخ...' : `نسخ ${titles.length} درس إلى ${picked.size} مادة`}
      </button>
    </div>
  );
}
