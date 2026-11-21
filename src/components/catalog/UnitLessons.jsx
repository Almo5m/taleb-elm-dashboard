import { useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useToast, useConfirm } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { isUniqueViolation, validateTitle } from '../../lib/catalog';
import {
  buildUnitLessonRows, findDuplicateLesson, formatUnitTitle, lessonOrderChanged, lessonsOfUnit, moveLesson, nextLessonOrder,
  planBulkInUnit, planMoveLessons, reorderLessonRows, unitNumbers, unitsOfTerm, TERM_TABS,
} from '../../lib/catalogUnits';

const DUPLICATE = 'الدرس ده موجود بالفعل في نفس الوحدة (نفس العنوان بعد قص المسافات وتجاهل حالة الأحرف)';
const DUPLICATE_NO_UNIT = 'الدرس ده موجود بالفعل في المادة (نفس العنوان بعد قص المسافات وتجاهل حالة الأحرف)';

// دروس وحدة واحدة (أو الدروس من غير وحدة لو unit = null): إضافة (واحد أو مجمّعة)، تعديل، ترتيب، إخفاء، مسح، ونقل لوحدة تانية.
// lessons = كل دروس المادة (الترتيب المعروض)، savedLessons = المحفوظ على السيرفر. الأب بيحمّل ويحدّث.
export default function UnitLessons({ subject, unit, units, lessons, savedLessons, setLessons, onReload, parentLocked }) {
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();
  const unitId = unit?.id ?? null;
  const [newTitle, setNewTitle] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [targetId, setTargetId] = useState('');

  const mine = useMemo(() => lessonsOfUnit(lessons, unitId), [lessons, unitId]);
  const dirty = lessonOrderChanged(savedLessons, lessons, unitId);
  const locked = busy || dirty || parentLocked;
  const duplicateMessage = unit ? DUPLICATE : DUPLICATE_NO_UNIT;
  const where = unit ? `وحدة "${unit.title}"` : 'دروس من غير وحدة';

  const audit = (action, details) => logAction({ adminId: me?.id, adminName: me?.name || 'أدمن', action, targetType: 'catalog_subject', targetId: subject.id, details });

  // الوحدات اللي ينفع الدروس تتنقل لها: كل وحدات المادة ماعدا الحالية، مجمّعة بالترم
  const targets = useMemo(() => {
    const numbers = unitNumbers(units);
    const label = subject.unit_label;
    return TERM_TABS.flatMap((tab) =>
      unitsOfTerm(units, tab.term).filter((u) => u.id !== unitId).map((u) => ({ id: u.id, text: `${tab.label} • ${formatUnitTitle(label, numbers[u.id], u.title) || u.title}${u.is_active ? '' : ' (مخفية)'}` }))
    );
  }, [units, subject.unit_label, unitId]);

  const addOne = async () => {
    const problem = validateTitle(newTitle);
    if (problem) { toast(problem, 'error'); return; }
    if (findDuplicateLesson(lessons, unitId, newTitle)) { toast(duplicateMessage, 'error'); return; }
    setBusy(true);
    const title = newTitle.trim();
    const { error } = await supabase.from('catalog_lessons').insert(buildUnitLessonRows(subject.id, unitId, [title], nextLessonOrder(lessons, unitId)));
    setBusy(false);
    if (error) { toast(isUniqueViolation(error) ? duplicateMessage : 'تعذّرت إضافة الدرس', 'error', error); return; }
    audit('catalog_lessons_add', `إضافة درس إلى ${where} في "${subject.subject_name}": ${title}`);
    setNewTitle('');
    toast('اتضاف الدرس');
    await onReload();
  };

  const addBulk = async () => {
    const plan = planBulkInUnit(bulkText, lessons, unitId);
    if (plan.toAdd.length === 0) { toast(plan.skipped > 0 ? `مفيش حاجة جديدة: اتخطى ${plan.skipped}` : 'اكتب الدروس، كل سطر درس', 'error'); return; }
    setBusy(true);
    const { error } = await supabase.from('catalog_lessons').insert(buildUnitLessonRows(subject.id, unitId, plan.toAdd, nextLessonOrder(lessons, unitId)));
    setBusy(false);
    if (error) { toast(isUniqueViolation(error) ? duplicateMessage : 'تعذّرت الإضافة المجمّعة. ماتضافش أي درس', 'error', error); return; }
    audit('catalog_lessons_add', `إضافة مجمّعة إلى ${where} في "${subject.subject_name}": اتضاف ${plan.toAdd.length}، اتخطى ${plan.skipped}`);
    setBulkText('');
    toast(`اتضاف ${plan.toAdd.length}، اتخطى ${plan.skipped} (المكرر جوه الوحدة)`);
    await onReload();
  };

  const saveTitle = async (lesson) => {
    const problem = validateTitle(editTitle);
    if (problem) { toast(problem, 'error'); return; }
    const title = editTitle.trim();
    if (title === lesson.title) { setEditingId(null); return; }
    if (findDuplicateLesson(lessons, unitId, title, lesson.id)) { toast(duplicateMessage, 'error'); return; }
    if (lesson.is_active) {
      const ok = await confirm(
        'الدرس ده ظاهر للطلاب. تعديل عنوانه بيخلّيه "جديد" عند الطلاب اللي نسخوا القديم، فهيطلعلهم مكرر.\nصحّح الأخطاء الإملائية قبل ما الطلاب ينسخوا. تكمّل؟',
        { confirmLabel: 'عدّل العنوان' }
      );
      if (!ok) return;
    }
    setBusy(true);
    const { error } = await supabase.from('catalog_lessons').update({ title }).eq('id', lesson.id);
    setBusy(false);
    if (error) { toast(isUniqueViolation(error) ? duplicateMessage : 'تعذّر تعديل العنوان', 'error', error); return; }
    setEditingId(null);
    toast('اتعدّل العنوان');
    await onReload();
  };

  const toggleActive = async (lesson) => {
    setBusy(true);
    const { error } = await supabase.from('catalog_lessons').update({ is_active: !lesson.is_active }).eq('id', lesson.id);
    setBusy(false);
    if (error) { toast('تعذّر تغيير حالة الدرس', 'error', error); return; }
    await onReload();
  };

  const removeLesson = async (lesson) => {
    const ok = await confirm(`هتمسح الدرس "${lesson.title}" نهائيًا. الإخفاء أفضل لو عايز ترجعه بعدين. متأكد؟`, { danger: true, confirmLabel: 'مسح نهائي' });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('catalog_lessons').delete().eq('id', lesson.id);
    setBusy(false);
    if (error) { toast('تعذّر مسح الدرس', 'error', error); return; }
    audit('catalog_lesson_delete', `مسح درس من ${where} في "${subject.subject_name}": ${lesson.title}`);
    toast('اتمسح الدرس');
    setPicked((prev) => { const n = new Set(prev); n.delete(lesson.id); return n; });
    await onReload();
  };

  const move = (id, dir) => { if (!busy) setLessons((prev) => moveLesson(prev, id, dir)); };

  const saveOrder = async () => {
    setBusy(true);
    const { error } = await supabase.from('catalog_lessons').upsert(reorderLessonRows(lessons, unitId), { onConflict: 'id' });
    setBusy(false);
    if (error) { toast('تعذّر حفظ الترتيب', 'error', error); return; }
    audit('catalog_lessons_reorder', `ترتيب ${mine.length} درس في ${where} في "${subject.subject_name}"`);
    toast('اتحفظ الترتيب');
    await onReload();
  };

  const togglePick = (id) => setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = mine.length > 0 && mine.every((l) => picked.has(l.id));
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(mine.map((l) => l.id)));

  const runMove = async () => {
    const target = units.find((u) => String(u.id) === targetId);
    if (!target) { toast('اختار الوحدة اللي هتنقل لها', 'error'); return; }
    const plan = planMoveLessons(lessons, [...picked], target);
    if (plan.moved === 0) { toast(plan.skipped.length ? `مفيش درس اتنقل: اتخطى ${plan.skipped.length} (مكرر في الوحدة الهدف)` : 'اختار دروس تنقلها', 'error'); return; }
    const skipNote = plan.skipped.length ? `\nهيتخطّى ${plan.skipped.length} لأن عنوانهم موجود في الوحدة الهدف.` : '';
    const ok = await confirm(
      `نقل ${plan.moved} درس إلى "${target.title}"؟${skipNote}\nالطلاب اللي نسخوا قبل كده بيفضل الدرس في وحدته القديمة عندهم. صحّح التوزيع قبل ما الطلاب ينسخوا.`,
      { confirmLabel: 'انقل' }
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('catalog_lessons').upsert(plan.rows, { onConflict: 'id' });
    setBusy(false);
    if (error) { toast('تعذّر النقل. ماتنقلش أي درس', 'error', error); return; }
    audit('catalog_lessons_move', `نقل ${plan.moved} درس من ${where} إلى وحدة "${target.title}" في "${subject.subject_name}" (اتخطى ${plan.skipped.length})`);
    toast(`اتنقل ${plan.moved}${plan.skipped.length ? `، اتخطى ${plan.skipped.length}` : ''}`);
    setPicked(new Set());
    setTargetId('');
    await onReload();
  };

  return (
    <div className="bg-surface rounded-xl p-3 mt-2">
      <div className="mb-3">
        <label className="text-xs text-muted font-semibold" htmlFor={`lesson-new-${unitId ?? 'none'}`}>إضافة درس</label>
        <div className="flex gap-2 mt-1">
          <input
            id={`lesson-new-${unitId ?? 'none'}`}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addOne(); }}
            placeholder="عنوان الدرس"
            className="input-field flex-1 min-w-0"
            disabled={locked}
          />
          <button onClick={addOne} disabled={locked} className="btn-primary !px-4 !py-2 text-sm shrink-0">إضافة</button>
        </div>
      </div>

      <details className="mb-3 bg-white rounded-xl p-3">
        <summary className="cursor-pointer text-sm font-semibold">إضافة مجمّعة (كل سطر درس)</summary>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={5}
          className="input-field w-full mt-3"
          placeholder={'الدرس الأول\nالدرس الثاني'}
          aria-label="إضافة مجمّعة"
          disabled={locked}
        />
        <p className="text-xs text-muted mt-1 mb-2">الأسطر الفاضية بتتجاهل، والمكرر جوه الوحدة بس بيتخطّى (نفس العنوان مسموح في وحدة تانية).</p>
        <button onClick={addBulk} disabled={locked || bulkText.trim() === ''} className="btn-primary !px-4 !py-1.5 text-sm">إضافة الأسطر</button>
      </details>

      {dirty && (
        <div className="flex flex-wrap items-center gap-2 bg-accent/10 border border-accent/40 rounded-xl p-3 mb-3 text-sm">
          <span className="font-semibold">الترتيب اتغيّر ومش محفوظ.</span>
          <button onClick={saveOrder} disabled={busy} className="btn-primary !px-4 !py-1.5 text-sm mr-auto">حفظ الترتيب</button>
          <button onClick={() => setLessons((prev) => [...prev.filter((l) => (l.unit_id ?? null) !== unitId), ...lessonsOfUnit(savedLessons, unitId)])} disabled={busy} className="btn-ghost !px-3 !py-1.5 text-sm">تراجع</button>
        </div>
      )}

      {picked.size > 0 && (
        <div className="bg-white border border-surface-line rounded-xl p-3 mb-3">
          <p className="text-sm font-semibold mb-2">{picked.size} درس محدد</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="input-field flex-1 min-w-0" aria-label="الوحدة اللي هتنقل لها">
              <option value="">انقل المحدد إلى وحدة...</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.text}</option>)}
            </select>
            <button onClick={runMove} disabled={locked || !targetId} className="btn-primary !px-4 !py-2 text-sm shrink-0">نقل</button>
          </div>
          {targets.length === 0 && <p className="text-xs text-amber-dark mt-2">مفيش وحدات تانية في المادة. أضف وحدة الأول.</p>}
        </div>
      )}

      {mine.length === 0 ? (
        <p className="text-sm text-muted">{unit ? 'مفيش دروس في الوحدة دي لسه.' : 'مفيش دروس من غير وحدة. كله متوزّع.'}</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs text-muted font-semibold mb-1 cursor-pointer w-fit">
            <input type="checkbox" checked={allPicked} onChange={toggleAll} className="accent-accent-dark" />
            تحديد كل الدروس ({mine.length})
          </label>
          <ol className="divide-y divide-surface-line">
            {mine.map((l, i) => (
              <li key={l.id} className={`py-2 flex flex-wrap items-center gap-2 ${l.is_active ? '' : 'opacity-60'}`}>
                <input type="checkbox" checked={picked.has(l.id)} onChange={() => togglePick(l.id)} className="accent-accent-dark shrink-0" aria-label={`تحديد ${l.title}`} />
                <span className="w-6 text-xs text-muted text-center shrink-0">{i + 1}</span>
                {editingId === l.id ? (
                  <div className="flex-1 min-w-[12rem] flex gap-2">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(l); if (e.key === 'Escape') setEditingId(null); }}
                      className="input-field flex-1 min-w-0"
                      aria-label="تعديل العنوان"
                      autoFocus
                    />
                    <button onClick={() => saveTitle(l)} disabled={busy} className="btn-primary !px-3 !py-1 text-xs shrink-0">حفظ</button>
                    <button onClick={() => setEditingId(null)} className="btn-ghost !px-3 !py-1 text-xs shrink-0">إلغاء</button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 min-w-[10rem] text-sm break-words" dir="auto">
                      {l.title}{!l.is_active && <span className="text-xs text-muted mr-2">(مخفي)</span>}
                    </span>
                    <span className="flex items-center gap-1 shrink-0 flex-wrap">
                      <button onClick={() => move(l.id, -1)} disabled={busy || i === 0} className="btn-ghost !px-2 !py-1 text-xs" aria-label="فوق" title="فوق">▲</button>
                      <button onClick={() => move(l.id, 1)} disabled={busy || i === mine.length - 1} className="btn-ghost !px-2 !py-1 text-xs" aria-label="تحت" title="تحت">▼</button>
                      <button onClick={() => { setEditingId(l.id); setEditTitle(l.title); }} disabled={locked} className="btn-ghost !px-2.5 !py-1 text-xs">تعديل</button>
                      <button onClick={() => toggleActive(l)} disabled={locked} className="btn-ghost !px-2.5 !py-1 text-xs">{l.is_active ? 'إخفاء' : 'إظهار'}</button>
                      <button onClick={() => removeLesson(l)} disabled={locked} className="btn-ghost !px-2.5 !py-1 text-xs text-coral-dark">مسح</button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
