import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Stamp, useToast, useConfirm } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { fetchAll } from '../../lib/fetchAll';
import { APP_MAX, WARN_VISIBLE, isUniqueViolation, lessonStats, trackLabel } from '../../lib/catalog';
import {
  DEFAULT_UNIT_LABEL, TERM_TABS, findDuplicateUnit, formatUnitTitle, lessonCountsByUnit, moveUnit, nextUnitOrder,
  reorderUnitRows, termFromSelect, termSelectValue, unitNumbers, unitOrderChanged, unitsOfTerm, validateUnitTitle,
} from '../../lib/catalogUnits';
import CopyCurriculumDialog from './CopyCurriculumDialog';
import UnitLessons from './UnitLessons';

const UNIT_DUPLICATE = 'فيه وحدة بنفس الاسم في نفس المادة والترم (قص المسافات وتجاهل حالة الأحرف)';

// محرر منهج مادة: مادة ← وحدات (حسب الترم) ← دروس. الترتيب ثابت في التطبيق وبتحدده انت،
// والرقم بيتحسب تلقائي من الترتيب جوه كل ترم (المعاينة جنب كل وحدة هي اللي هيشوفها الطالب).
export default function CurriculumEditor({ subject, subjects, onChanged, onClose }) {
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();
  const label = subject.unit_label || DEFAULT_UNIT_LABEL;

  const [units, setUnits] = useState(null);
  const [savedUnits, setSavedUnits] = useState([]);
  const [lessons, setLessons] = useState(null);
  const [savedLessons, setSavedLessons] = useState([]);
  const [tab, setTab] = useState('1'); // '1' | '2' | 'year' | 'none'
  const [openUnit, setOpenUnit] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [newHidden, setNewHidden] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

  const audit = (action, details) => logAction({ adminId: me?.id, adminName: me?.name || 'أدمن', action, targetType: 'catalog_subject', targetId: subject.id, details });

  const load = async () => {
    const [u, l] = await Promise.all([
      fetchAll(() => supabase.from('catalog_units').select('*').eq('subject_id', subject.id).order('sort_order').order('id')),
      fetchAll(() => supabase.from('catalog_lessons').select('*').eq('subject_id', subject.id).order('sort_order').order('id')),
    ]);
    if (u.error || l.error) toast('تعذّر تحميل منهج المادة', 'error', u.error || l.error);
    setUnits(u.data || []); setSavedUnits(u.data || []);
    setLessons(l.data || []); setSavedLessons(l.data || []);
  };

  useEffect(() => {
    setUnits(null); setLessons(null); setTab('1'); setOpenUnit(null); setNewTitle(''); setEditingId(null); setCopyOpen(false);
    load();
  }, [subject.id]);

  const reload = async () => { await load(); await onChanged(); };

  const allUnits = units || [];
  const allLessons = lessons || [];
  const unitsDirty = units !== null && unitOrderChanged(savedUnits, units);
  const locked = busy || unitsDirty;
  const numbers = useMemo(() => unitNumbers(allUnits), [allUnits]);
  const counts = useMemo(() => lessonCountsByUnit(allLessons), [allLessons]);
  const stat = lessonStats(allLessons);
  const noUnit = counts.none || { visible: 0, hidden: 0 };
  const noUnitTotal = noUnit.visible + noUnit.hidden;

  const termTabs = TERM_TABS.map((t) => ({ ...t, count: unitsOfTerm(allUnits, t.term).length }));
  const activeTerm = TERM_TABS.find((t) => t.key === tab);
  const shown = activeTerm ? unitsOfTerm(allUnits, activeTerm.term) : [];

  const addUnit = async () => {
    const problem = validateUnitTitle(newTitle);
    if (problem) { toast(problem, 'error'); return; }
    const term = activeTerm.term;
    if (findDuplicateUnit(allUnits, newTitle, term)) { toast(UNIT_DUPLICATE, 'error'); return; }
    setBusy(true);
    const title = newTitle.trim();
    const { error } = await supabase.from('catalog_units').insert({ subject_id: subject.id, title, term, sort_order: nextUnitOrder(allUnits), is_active: !newHidden });
    setBusy(false);
    if (error) { toast(isUniqueViolation(error) ? UNIT_DUPLICATE : 'تعذّرت إضافة الوحدة', 'error', error); return; }
    audit('catalog_unit_add', `إضافة ${label} "${title}" (${activeTerm.label}${newHidden ? '، مخفية' : ''}) إلى "${subject.subject_name}"`);
    setNewTitle('');
    toast('اتضافت الوحدة');
    await reload();
  };

  const saveTitle = async (unit) => {
    const problem = validateUnitTitle(editTitle);
    if (problem) { toast(problem, 'error'); return; }
    const title = editTitle.trim();
    if (title === unit.title) { setEditingId(null); return; }
    if (findDuplicateUnit(allUnits, title, unit.term, unit.id)) { toast(UNIT_DUPLICATE, 'error'); return; }
    if (unit.is_active) {
      const ok = await confirm(
        'الوحدة دي ظاهرة للطلاب. تعديل اسمها بيخلّيها "جديدة" عند الطلاب اللي نسخوا القديمة فهتطلعلهم مكررة.\nصحّح الأخطاء الإملائية قبل ما الطلاب ينسخوا. تكمّل؟',
        { confirmLabel: 'عدّل الاسم' }
      );
      if (!ok) return;
    }
    setBusy(true);
    const { error } = await supabase.from('catalog_units').update({ title }).eq('id', unit.id);
    setBusy(false);
    if (error) { toast(isUniqueViolation(error) ? UNIT_DUPLICATE : 'تعذّر تعديل اسم الوحدة', 'error', error); return; }
    audit('catalog_unit_edit', `تعديل اسم وحدة في "${subject.subject_name}": "${unit.title}" ← "${title}"`);
    setEditingId(null);
    toast('اتعدّل الاسم');
    await reload();
  };

  const changeTerm = async (unit, value) => {
    const term = termFromSelect(value);
    if (term === (unit.term ?? null)) return;
    if (findDuplicateUnit(allUnits, unit.title, term, unit.id)) { toast(UNIT_DUPLICATE, 'error'); return; }
    if (unit.is_active) {
      const ok = await confirm('تغيير ترم وحدة ظاهرة بيغيّر أرقام الوحدات في الترمين، وبيتحدّث عند الطلاب اللي نسخوها. تكمّل؟', { confirmLabel: 'غيّر الترم' });
      if (!ok) return;
    }
    setBusy(true);
    const { error } = await supabase.from('catalog_units').update({ term }).eq('id', unit.id);
    setBusy(false);
    if (error) { toast(isUniqueViolation(error) ? UNIT_DUPLICATE : 'تعذّر تغيير الترم', 'error', error); return; }
    audit('catalog_unit_edit', `نقل وحدة "${unit.title}" في "${subject.subject_name}" إلى ${TERM_TABS.find((t) => t.term === term).label}`);
    toast('اتغيّر الترم');
    await reload();
  };

  const toggleActive = async (unit) => {
    setBusy(true);
    const { error } = await supabase.from('catalog_units').update({ is_active: !unit.is_active }).eq('id', unit.id);
    setBusy(false);
    if (error) { toast('تعذّر تغيير حالة الوحدة', 'error', error); return; }
    audit('catalog_unit_edit', `${unit.is_active ? 'إخفاء' : 'إظهار'} وحدة "${unit.title}" في "${subject.subject_name}"`);
    await reload();
  };

  const removeUnit = async (unit) => {
    const c = counts[unit.id] || { visible: 0, hidden: 0 };
    const n = c.visible + c.hidden;
    const ok = await confirm(
      `هتمسح الوحدة "${unit.title}" نهائيًا.\nدروسها (${n}${c.hidden ? `، منهم ${c.hidden} مخفي` : ''}) مش هتتمسح: هتبقى "من غير وحدة" وهتظهر للطلاب كدروس قديمة.\nالإخفاء أفضل دايمًا. متأكد؟`,
      { danger: true, confirmLabel: 'مسح الوحدة' }
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('catalog_units').delete().eq('id', unit.id);
    setBusy(false);
    if (error) { toast('تعذّر مسح الوحدة', 'error', error); return; }
    audit('catalog_unit_delete', `مسح وحدة "${unit.title}" من "${subject.subject_name}" (${n} درس بقوا من غير وحدة)`);
    toast(n ? `اتمسحت الوحدة. ${n} درس بقوا من غير وحدة` : 'اتمسحت الوحدة');
    if (openUnit === unit.id) setOpenUnit(null);
    await reload();
  };

  const saveUnitOrder = async () => {
    setBusy(true);
    const { error } = await supabase.from('catalog_units').upsert(reorderUnitRows(allUnits), { onConflict: 'id' });
    setBusy(false);
    if (error) { toast('تعذّر حفظ ترتيب الوحدات', 'error', error); return; }
    audit('catalog_unit_reorder', `ترتيب ${allUnits.length} وحدة في "${subject.subject_name}"`);
    toast('اتحفظ الترتيب. الأرقام اتحدّثت');
    await reload();
  };

  const lessonProps = { subject: { ...subject, unit_label: label }, units: allUnits, lessons: allLessons, savedLessons, setLessons, onReload: reload, parentLocked: unitsDirty };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <p className="font-messiri font-bold text-lg break-words">{subject.subject_name}</p>
          <p className="text-xs text-muted">{subject.system} • {subject.grade} • {trackLabel(subject.track)} • مسمى الوحدات: <b>{label}</b></p>
        </div>
        <button onClick={onClose} className="btn-ghost !px-3 !py-1.5 text-sm shrink-0">إغلاق</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 my-3">
        <Stamp tone="forest">{stat.visible} درس ظاهر</Stamp>
        <Stamp tone="ink">{stat.hidden} مخفي</Stamp>
        <span className="text-xs text-muted">{allUnits.length} وحدة</span>
        <button onClick={() => setCopyOpen((v) => !v)} className="btn-ghost !px-3 !py-1 text-xs mr-auto" disabled={lessons === null || units === null}>نسخ المنهج لمواد تانية</button>
      </div>

      {stat.visible > WARN_VISIBLE && (
        <p className="text-sm bg-amber/10 border border-amber/40 rounded-xl p-3 mb-3 text-amber-dark font-semibold" role="alert">
          الدروس الظاهرة ({stat.visible}) عدّت {WARN_VISIBLE}. التطبيق بياخد {APP_MAX} بحد أقصى للمادة{stat.visible > APP_MAX ? '، وفيه دروس زيادة مش هتظهر للطلاب' : ''}.
        </p>
      )}

      {copyOpen && (
        <CopyCurriculumDialog source={subject} sourceUnits={allUnits} sourceLessons={allLessons} subjects={subjects} onClose={() => setCopyOpen(false)} onDone={onChanged} />
      )}

      {units === null || lessons === null ? (
        <p className="text-sm text-muted">بيتحمّل...</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="ترمات المادة">
            {termTabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${tab === t.key ? 'bg-ink text-accent' : 'bg-white border border-surface-line text-muted hover:text-ink'}`}
              >
                {t.label} <span className="text-xs opacity-70">{t.count}</span>
              </button>
            ))}
            <button
              role="tab"
              aria-selected={tab === 'none'}
              onClick={() => setTab('none')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${tab === 'none' ? 'bg-ink text-accent' : noUnitTotal > 0 ? 'bg-amber/10 border border-amber/50 text-amber-dark' : 'bg-white border border-surface-line text-muted hover:text-ink'}`}
            >
              دروس من غير وحدة <span className="text-xs opacity-70">{noUnitTotal}</span>
            </button>
          </div>

          {unitsDirty && (
            <div className="flex flex-wrap items-center gap-2 bg-accent/10 border border-accent/40 rounded-xl p-3 mb-3 text-sm">
              <span className="font-semibold">ترتيب الوحدات اتغيّر ومش محفوظ (الأرقام هتتغيّر بعد الحفظ).</span>
              <button onClick={saveUnitOrder} disabled={busy} className="btn-primary !px-4 !py-1.5 text-sm mr-auto">حفظ الترتيب</button>
              <button onClick={() => setUnits(savedUnits)} disabled={busy} className="btn-ghost !px-3 !py-1.5 text-sm">تراجع</button>
            </div>
          )}

          {tab === 'none' ? (
            <>
              {noUnit.visible > 0 && (
                <p className="text-sm bg-amber/10 border border-amber/40 rounded-xl p-3 mb-3 text-amber-dark font-semibold" role="alert">
                  {noUnit.visible} درس ظاهر من غير وحدة. حدّدهم وانقلهم لوحدة، وحتى كده بيظهروا للطلاب كدروس قديمة.
                </p>
              )}
              <UnitLessons key="none" unit={null} {...lessonProps} />
            </>
          ) : (
            <>
              <div className="mb-4">
                <label className="text-xs text-muted font-semibold" htmlFor="unit-new">إضافة {label} في {activeTerm.label}</label>
                <div className="flex gap-2 mt-1">
                  <input
                    id="unit-new"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addUnit(); }}
                    placeholder="اسم الوحدة بس (من غير رقم ولا كلمة الباب)"
                    className="input-field flex-1 min-w-0"
                    disabled={locked}
                  />
                  <button onClick={addUnit} disabled={locked} className="btn-primary !px-4 !py-2 text-sm shrink-0">إضافة</button>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted mt-2 cursor-pointer w-fit">
                  <input type="checkbox" checked={newHidden} onChange={(e) => setNewHidden(e.target.checked)} className="accent-accent-dark" />
                  أضفها مخفية (لتجهيز الترم التاني قبل ما تظهر للطلاب)
                </label>
              </div>

              {shown.length === 0 ? (
                <p className="text-sm text-muted">مفيش وحدات في {activeTerm.label}. أضف أول وحدة.</p>
              ) : (
                <ol className="space-y-3">
                  {shown.map((u, i) => {
                    const c = counts[u.id] || { visible: 0, hidden: 0 };
                    const preview = formatUnitTitle(label, numbers[u.id], u.title);
                    const open = openUnit === u.id;
                    return (
                      <li key={u.id} className={`rounded-xl border p-3 ${u.is_active ? 'border-surface-line bg-white' : 'border-dashed border-surface-line bg-surface opacity-80'}`}>
                        {editingId === u.id ? (
                          <div className="flex gap-2 mb-2">
                            <input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(u); if (e.key === 'Escape') setEditingId(null); }}
                              className="input-field flex-1 min-w-0"
                              aria-label="تعديل اسم الوحدة"
                              autoFocus
                            />
                            <button onClick={() => saveTitle(u)} disabled={busy} className="btn-primary !px-3 !py-1 text-xs shrink-0">حفظ</button>
                            <button onClick={() => setEditingId(null)} className="btn-ghost !px-3 !py-1 text-xs shrink-0">إلغاء</button>
                          </div>
                        ) : (
                          <div className="mb-2">
                            <p className="font-semibold text-sm break-words" dir="auto">{preview}</p>
                            <p className="text-[11px] text-muted mt-0.5">
                              {u.is_active ? 'ده اللي هيظهر للطالب' : 'مخفية: مش ظاهرة للطلاب ومالهاش رقم'} · {c.visible} درس ظاهر{c.hidden ? ` · ${c.hidden} مخفي` : ''}
                            </p>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button onClick={() => setUnits((prev) => moveUnit(prev, u.id, -1))} disabled={busy || i === 0} className="btn-ghost !px-2 !py-1 text-xs" aria-label="فوق" title="فوق">▲</button>
                          <button onClick={() => setUnits((prev) => moveUnit(prev, u.id, 1))} disabled={busy || i === shown.length - 1} className="btn-ghost !px-2 !py-1 text-xs" aria-label="تحت" title="تحت">▼</button>
                          <select
                            value={termSelectValue(u.term)}
                            onChange={(e) => changeTerm(u, e.target.value)}
                            disabled={locked}
                            className="input-field !py-1 !px-2 text-xs w-auto"
                            aria-label="ترم الوحدة"
                          >
                            <option value="1">الترم الأول</option>
                            <option value="2">الترم الثاني</option>
                            <option value="">السنة كاملة</option>
                          </select>
                          <button onClick={() => { setEditingId(u.id); setEditTitle(u.title); }} disabled={locked} className="btn-ghost !px-2.5 !py-1 text-xs">تعديل</button>
                          <button onClick={() => toggleActive(u)} disabled={locked} className="btn-ghost !px-2.5 !py-1 text-xs">{u.is_active ? 'إخفاء' : 'إظهار'}</button>
                          <button onClick={() => removeUnit(u)} disabled={locked} className="btn-ghost !px-2.5 !py-1 text-xs text-coral-dark">مسح</button>
                          <button onClick={() => setOpenUnit(open ? null : u.id)} className="btn-primary !px-3 !py-1 text-xs mr-auto" aria-expanded={open}>
                            {open ? 'إخفاء الدروس' : `الدروس (${c.visible + c.hidden})`}
                          </button>
                        </div>

                        {open && <UnitLessons key={u.id} unit={u} {...lessonProps} />}
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
