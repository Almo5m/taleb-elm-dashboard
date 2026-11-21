import { useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Stamp, useToast } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { fetchAll } from '../../lib/fetchAll';
import { groupSubjects, trackLabel } from '../../lib/catalog';
import { buildUnitLessonRows, planCurriculumCopy } from '../../lib/catalogUnits';

// نسخ منهج المادة (الوحدات الظاهرة بدروسها الظاهرة، بنفس الترتيب والترم + الدروس الظاهرة من غير وحدة) لمواد تانية.
// وحدة بنفس الاسم والترم في الهدف: بتتضاف لها الدروس الناقصة بس. المكرر جوه الوحدة بيتخطّى.
// العملية مش ذرية عبر المواد (كل مادة لوحدها)، فالملخص بيقولك إيه اللي نجح وإيه اللي فشل.
export default function CopyCurriculumDialog({ source, sourceUnits, sourceLessons, subjects, onClose, onDone }) {
  const toast = useToast();
  const me = useAppUser();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);

  const activeUnits = sourceUnits.filter((u) => u.is_active).length;
  const activeLessons = sourceLessons.filter((l) => l.is_active).length;
  const groups = useMemo(() => groupSubjects(subjects, { excludeId: source.id, query }), [subjects, source.id, query]);

  const toggle = (id) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleGroup = (g) => setPicked((prev) => {
    const next = new Set(prev);
    const all = g.subjects.every((s) => next.has(s.id));
    g.subjects.forEach((s) => (all ? next.delete(s.id) : next.add(s.id)));
    return next;
  });

  const copyInto = async (targetId) => {
    const [tu, tl] = await Promise.all([
      fetchAll(() => supabase.from('catalog_units').select('*').eq('subject_id', targetId).order('id')),
      fetchAll(() => supabase.from('catalog_lessons').select('*').eq('subject_id', targetId).order('id')),
    ]);
    if (tu.error || tl.error) throw tu.error || tl.error;
    const plan = planCurriculumCopy({ sourceUnits, sourceLessons, targetUnits: tu.data, targetLessons: tl.data });

    for (const m of plan.mergeUnits) {
      if (m.toAdd.length === 0) continue;
      const { error } = await supabase.from('catalog_lessons').insert(buildUnitLessonRows(targetId, m.unitId, m.toAdd, m.startOrder));
      if (error) throw error;
    }
    for (const u of plan.createUnits) {
      const { data, error } = await supabase
        .from('catalog_units')
        .insert({ subject_id: targetId, title: u.title, term: u.term, sort_order: u.sort_order, is_active: true })
        .select('id')
        .single();
      if (error) throw error;
      if (u.lessons.length > 0) {
        const { error: lessonError } = await supabase.from('catalog_lessons').insert(buildUnitLessonRows(targetId, data.id, u.lessons, 1));
        if (lessonError) throw lessonError;
      }
    }
    if (plan.noUnit.length > 0) {
      const { error } = await supabase.from('catalog_lessons').insert(buildUnitLessonRows(targetId, null, plan.noUnit, plan.noUnitStart));
      if (error) throw error;
    }
    return plan;
  };

  const run = async () => {
    if (picked.size === 0 || running || activeLessons + activeUnits === 0) return;
    setRunning(true);
    const out = [];
    let firstError = null;
    for (const id of picked) {
      const target = subjects.find((s) => s.id === id);
      try {
        const plan = await copyInto(id);
        out.push({ id, name: target.subject_name, units: plan.addedUnits, added: plan.addedLessons, skipped: plan.skippedLessons });
      } catch (error) {
        firstError ||= error;
        out.push({ id, name: target.subject_name, error: true });
      }
    }
    setRunning(false);
    setResults(out);
    if (firstError) toast('فشل النسخ لبعض المواد', 'error', firstError);
    logAction({
      adminId: me?.id, adminName: me?.name || 'أدمن', action: 'catalog_curriculum_copy', targetType: 'catalog_subject', targetId: source.id,
      details: `نسخ منهج "${source.subject_name}" إلى ${out.length} مادة (وحدات ${out.reduce((s, r) => s + (r.units || 0), 0)}، دروس ${out.reduce((s, r) => s + (r.added || 0), 0)}، فشل ${out.filter((r) => r.error).length})`,
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
              {r.error ? <Stamp tone="coral">فشل (راجع اللي اتنسخ قبل الفشل)</Stamp> : <span className="text-muted">وحدات جديدة {r.units}، دروس اتضافت {r.added}، اتخطى {r.skipped}</span>}
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
        <p className="font-semibold">نسخ منهج "{source.subject_name}" لمواد تانية</p>
        <button onClick={onClose} className="btn-ghost !px-3 !py-1 text-xs shrink-0">إلغاء</button>
      </div>
      <p className="text-xs text-muted mb-3">
        هتتنسخ {activeUnits} وحدة ظاهرة ودروسها الظاهرة، بنفس الترتيب والترم، ومعاهم الدروس الظاهرة من غير وحدة. الوحدة اللي بنفس الاسم والترم في المادة الهدف بتتضاف لها الدروس الناقصة بس.
      </p>
      {activeLessons + activeUnits === 0 && <p className="text-sm text-coral-dark mb-3" role="alert">مفيش وحدات ولا دروس ظاهرة في المادة دي عشان تتنسخ.</p>}
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
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <button onClick={run} disabled={picked.size === 0 || running || activeLessons + activeUnits === 0} className="btn-primary !px-5 !py-2 text-sm">
        {running ? 'بينسخ...' : `نسخ المنهج إلى ${picked.size} مادة`}
      </button>
    </div>
  );
}
