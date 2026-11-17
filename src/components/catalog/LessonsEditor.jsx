import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Stamp, useToast, useConfirm } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { fetchAll } from '../../lib/fetchAll';
import {
  APP_MAX, WARN_VISIBLE, buildInsertRows, isUniqueViolation, lessonStats, moveItem, nextSortOrder, normalizeTitle,
  orderChanged, parseBulkLines, reorderRows, trackLabel, validateTitle,
} from '../../lib/catalog';
import CopyLessonsDialog from './CopyLessonsDialog';

// محرر دروس مادة واحدة: إضافة (واحد أو مجمّعة)، تعديل العنوان، ترتيب بأسهم، إخفاء/إظهار، مسح، ونسخ لمواد تانية.
// اللي اتنسخ لطالب خلاص مبيتأثرش بأي تعديل أو إخفاء أو مسح هنا.
export default function LessonsEditor({ subject, subjects, stats, onChanged, onClose }) {
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();

  const [lessons, setLessons] = useState(null); // الترتيب المعروض (ممكن يتغيّر محليًا لحد ما تحفظ)
  const [saved, setSaved] = useState([]); // الترتيب المحفوظ على السيرفر
  const [search, setSearch] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

  const audit = (action, details) => logAction({ adminId: me?.id, adminName: me?.name || 'أدمن', action, targetType: 'catalog_subject', targetId: subject.id, details });

  const load = async () => {
    const { data, error } = await fetchAll(() =>
      supabase.from('catalog_lessons').select('*').eq('subject_id', subject.id).order('sort_order').order('id')
    );
    if (error) toast('تعذّر تحميل دروس المادة', 'error', error);
    setLessons(data || []);
    setSaved(data || []);
  };

  useEffect(() => {
    setLessons(null); setSearch(''); setNewTitle(''); setBulkText(''); setEditingId(null); setCopyOpen(false);
    load();
  }, [subject.id]);

  const all = lessons || [];
  const dirty = lessons !== null && orderChanged(saved, lessons);
  const stat = lessonStats(all);
  const searching = search.trim() !== '';
  const shown = useMemo(
    () => (searching ? all.filter((l) => normalizeTitle(l.title).includes(normalizeTitle(search))) : all),
    [all, search, searching]
  );
  const locked = dirty || busy; // لحد ما تحفظ الترتيب أو تلغيه، باقي التعديلات مقفولة

  const afterChange = async () => { await load(); onChanged(); };

  const duplicateMessage = 'الدرس ده موجود بالفعل في المادة (نفس العنوان بعد قص المسافات وتجاهل حالة الأحرف)';

  const addOne = async () => {
    const problem = validateTitle(newTitle);
    if (problem) { toast(problem, 'error'); return; }
    if (all.some((l) => normalizeTitle(l.title) === normalizeTitle(newTitle))) { toast(duplicateMessage, 'error'); return; }
    setBusy(true);
    const title = newTitle.trim();
    const { error } = await supabase.from('catalog_lessons').insert(buildInsertRows(subject.id, [title], nextSortOrder(all)));
    setBusy(false);
    if (error) { toast(isUniqueViolation(error) ? duplicateMessage : 'تعذّرت إضافة الدرس', 'error', error); return; }
    audit('catalog_lessons_add', `إضافة درس إلى "${subject.subject_name}": ${title}`);
    setNewTitle('');
    toast('اتضاف الدرس');
    await afterChange();
  };

  const addBulk = async () => {
    const plan = parseBulkLines(bulkText, all.map((l) => l.title));
    if (plan.toAdd.length === 0) {
      toast(plan.skipped > 0 ? `مفيش حاجة جديدة: اتخطى ${plan.skipped}` : 'اكتب الدروس، كل سطر درس', 'error');
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('catalog_lessons').insert(buildInsertRows(subject.id, plan.toAdd, nextSortOrder(all)));
    setBusy(false);
    if (error) { toast(isUniqueViolation(error) ? duplicateMessage : 'تعذّرت الإضافة المجمّعة. ماتضافش أي درس', 'error', error); return; }
    audit('catalog_lessons_add', `إضافة مجمّعة إلى "${subject.subject_name}": اتضاف ${plan.toAdd.length}، اتخطى ${plan.skipped}`);
    setBulkText('');
    toast(`اتضاف ${plan.toAdd.length}، اتخطى ${plan.skipped}`);
    await afterChange();
  };

  const saveTitle = async (lesson) => {
    const problem = validateTitle(editTitle);
    if (problem) { toast(problem, 'error'); return; }
    const title = editTitle.trim();
    if (title === lesson.title) { setEditingId(null); return; }
    if (all.some((l) => l.id !== lesson.id && normalizeTitle(l.title) === normalizeTitle(title))) { toast(duplicateMessage, 'error'); return; }
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
    await afterChange();
  };

  const toggleActive = async (lesson) => {
    setBusy(true);
    const { error } = await supabase.from('catalog_lessons').update({ is_active: !lesson.is_active }).eq('id', lesson.id);
    setBusy(false);
    if (error) { toast('تعذّر تغيير حالة الدرس', 'error', error); return; }
    await afterChange();
  };

  const removeLesson = async (lesson) => {
    const ok = await confirm(`هتمسح الدرس "${lesson.title}" نهائيًا. الإخفاء أفضل لو عايز ترجعه بعدين. متأكد؟`, { danger: true, confirmLabel: 'مسح نهائي' });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('catalog_lessons').delete().eq('id', lesson.id);
    setBusy(false);
    if (error) { toast('تعذّر مسح الدرس', 'error', error); return; }
    audit('catalog_lesson_delete', `مسح درس من "${subject.subject_name}": ${lesson.title}`);
    toast('اتمسح الدرس');
    await afterChange();
  };

  const move = (visibleIndex, dir) => {
    if (searching || busy) return;
    setLessons((prev) => moveItem(prev, visibleIndex, dir));
  };

  const saveOrder = async () => {
    setBusy(true);
    const { error } = await supabase.from('catalog_lessons').upsert(reorderRows(all), { onConflict: 'id' });
    setBusy(false);
    if (error) { toast('تعذّر حفظ الترتيب', 'error', error); return; }
    audit('catalog_lessons_reorder', `ترتيب ${all.length} درس في "${subject.subject_name}"`);
    toast('اتحفظ الترتيب');
    await afterChange();
  };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <p className="font-messiri font-bold text-lg break-words">{subject.subject_name}</p>
          <p className="text-xs text-muted">{subject.system} • {subject.grade} • {trackLabel(subject.track)}</p>
        </div>
        <button onClick={onClose} className="btn-ghost !px-3 !py-1.5 text-sm shrink-0">إغلاق</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 my-3">
        <Stamp tone="forest">{stat.visible} ظاهر</Stamp>
        <Stamp tone="ink">{stat.hidden} مخفي</Stamp>
        <span className="text-xs text-muted">الإجمالي {stat.total}</span>
        <button onClick={() => setCopyOpen((v) => !v)} className="btn-ghost !px-3 !py-1 text-xs mr-auto" disabled={lessons === null}>نسخ لمواد تانية</button>
      </div>

      {stat.visible > WARN_VISIBLE && (
        <p className="text-sm bg-amber/10 border border-amber/40 rounded-xl p-3 mb-3 text-amber-dark font-semibold" role="alert">
          الدروس الظاهرة ({stat.visible}) عدّت {WARN_VISIBLE}. التطبيق بياخد {APP_MAX} بحد أقصى للمادة{stat.visible > APP_MAX ? '، وفيه دروس زيادة مش هتظهر للطلاب' : ''}.
        </p>
      )}

      {copyOpen && (
        <CopyLessonsDialog
          source={subject}
          sourceLessons={all}
          subjects={subjects}
          stats={stats}
          onClose={() => setCopyOpen(false)}
          onDone={onChanged}
        />
      )}

      <div className="mb-4">
        <label className="text-xs text-muted font-semibold" htmlFor="lesson-new">إضافة درس</label>
        <div className="flex gap-2 mt-1">
          <input
            id="lesson-new"
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

      <details className="mb-4 bg-surface rounded-xl p-3">
        <summary className="cursor-pointer text-sm font-semibold">إضافة مجمّعة (كل سطر درس)</summary>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={6}
          className="input-field w-full mt-3"
          placeholder={'الدرس الأول\nالدرس الثاني\nالدرس الثالث'}
          aria-label="إضافة مجمّعة"
          disabled={locked}
        />
        <p className="text-xs text-muted mt-1 mb-2">الأسطر الفاضية بتتجاهل، والمسافات بتتقص، والمكرر (جوه الصندوق أو الموجود) بيتخطّى، والباقي بيتضاف بعد آخر ترتيب.</p>
        <button onClick={addBulk} disabled={locked || bulkText.trim() === ''} className="btn-primary !px-4 !py-1.5 text-sm">إضافة الأسطر</button>
      </details>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث سريع في الدروس" className="input-field mb-3" aria-label="بحث في الدروس" />

      {dirty && (
        <div className="flex flex-wrap items-center gap-2 bg-accent/10 border border-accent/40 rounded-xl p-3 mb-3 text-sm">
          <span className="font-semibold">الترتيب اتغيّر ومش محفوظ.</span>
          <button onClick={saveOrder} disabled={busy} className="btn-primary !px-4 !py-1.5 text-sm mr-auto">حفظ الترتيب</button>
          <button onClick={() => setLessons(saved)} disabled={busy} className="btn-ghost !px-3 !py-1.5 text-sm">تراجع</button>
        </div>
      )}
      {searching && all.length > 1 && <p className="text-xs text-muted mb-2">امسح البحث عشان تقدر ترتّب بالأسهم.</p>}

      {lessons === null ? (
        <p className="text-sm text-muted">بيتحمّل...</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">{searching ? 'مفيش دروس مطابقة للبحث.' : 'مفيش دروس لسه. أضف أول درس.'}</p>
      ) : (
        <ol className="divide-y divide-surface-line">
          {shown.map((l, i) => {
            const position = all.indexOf(l);
            return (
              <li key={l.id} className={`py-2.5 flex flex-wrap items-center gap-2 ${l.is_active ? '' : 'opacity-60'}`}>
                <span className="w-7 text-xs text-muted text-center shrink-0">{position + 1}</span>
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
                      {l.title}
                      {!l.is_active && <span className="text-xs text-muted mr-2">(مخفي)</span>}
                    </span>
                    <span className="flex items-center gap-1 shrink-0 flex-wrap">
                      <button onClick={() => move(position, -1)} disabled={searching || busy || position === 0} className="btn-ghost !px-2 !py-1 text-xs" aria-label="فوق" title="فوق">▲</button>
                      <button onClick={() => move(position, 1)} disabled={searching || busy || position === all.length - 1} className="btn-ghost !px-2 !py-1 text-xs" aria-label="تحت" title="تحت">▼</button>
                      <button onClick={() => { setEditingId(l.id); setEditTitle(l.title); }} disabled={locked} className="btn-ghost !px-2.5 !py-1 text-xs">تعديل</button>
                      <button onClick={() => toggleActive(l)} disabled={locked} className="btn-ghost !px-2.5 !py-1 text-xs">{l.is_active ? 'إخفاء' : 'إظهار'}</button>
                      <button onClick={() => removeLesson(l)} disabled={locked} className="btn-ghost !px-2.5 !py-1 text-xs text-coral-dark">مسح</button>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
