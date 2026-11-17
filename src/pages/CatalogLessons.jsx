import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState, useToast, useConfirm } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';
import { fetchAll } from '../lib/fetchAll';
import { GRADES, SYSTEMS, hasTracks } from '../lib/divisions';
import { isMissingRelation, statsFromLessons, statsMap, subjectsFor, trackChoices, trackLabel } from '../lib/catalog';
import CoverageCard from '../components/catalog/CoverageCard';
import LessonsEditor from '../components/catalog/LessonsEditor';
import SubjectDialog from '../components/catalog/SubjectDialog';

// دروس المنهج (للأدمن بس): الأدمن بيكتب دروس كل مادة لكل نظام وصف وشعبة، والطالب بيدوس "ضيف دروس المنهج"
// في التطبيق فالدروس بتتنسخ لقايمته المحلية. بعد النسخ هي دروسه هو واللوحة مبتلمسهاش.
// القيم (نظام/صف/شعبة) من src/lib/divisions.js، والمنطق في src/lib/catalog.js.

const tabClass = (active) =>
  `px-3 py-1.5 rounded-lg text-sm font-semibold transition ${active ? 'bg-ink text-accent' : 'bg-white border border-surface-line text-muted hover:text-ink'}`;

export default function CatalogLessons() {
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();
  const editorRef = useRef(null);

  const [subjects, setSubjects] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [system, setSystem] = useState(SYSTEMS[0]);
  const [grade, setGrade] = useState(GRADES[0]);
  const [track, setTrack] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [dialog, setDialog] = useState(null); // { mode: 'add' } | { mode: 'edit', subject }

  const loadStats = async () => {
    const view = await fetchAll(() => supabase.from('catalog_subject_stats').select('*').order('subject_id'));
    if (!view.error) { setStats(statsMap(view.data)); return; }
    if (!isMissingRelation(view.error)) { toast('تعذّر تحميل عدّادات الدروس', 'error', view.error); return; }
    // الـ view لسه ماتعملتش (sql/supabase_catalog_admin.sql): بنعدّ من الدروس مباشرة (أبطأ لما الدروس تكتر)
    const lessons = await fetchAll(() => supabase.from('catalog_lessons').select('subject_id, is_active').order('id'));
    if (lessons.error) { toast('تعذّر تحميل عدّادات الدروس', 'error', lessons.error); return; }
    setStats(statsFromLessons(lessons.data));
  };

  const loadSubjects = async () => {
    const { data, error } = await fetchAll(() => supabase.from('catalog_subjects').select('*').order('sort_order').order('id'));
    if (isMissingRelation(error)) { setMissing(true); setLoading(false); return false; }
    if (error) toast('تعذّر تحميل المواد', 'error', error);
    setMissing(false);
    setSubjects(data || []);
    return true;
  };

  useEffect(() => {
    (async () => {
      if (await loadSubjects()) await loadStats();
      setLoading(false);
    })();
  }, []);

  const list = useMemo(() => subjectsFor(subjects, { system, grade, track }), [subjects, system, grade, track]);
  const openSubject = subjects.find((s) => s.id === openId) || null;
  const choices = trackChoices(system, grade);

  const pickSystem = (v) => { setSystem(v); setTrack(null); setOpenId(null); setDialog(null); };
  const pickGrade = (v) => { setGrade(v); setTrack(null); setOpenId(null); setDialog(null); };
  const pickTrack = (v) => { setTrack(v); setOpenId(null); };

  const openEditor = (id) => {
    setOpenId(id);
    setDialog(null);
    setTimeout(() => editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50);
  };

  const removeSubject = async (s) => {
    const n = (stats[s.id]?.visible || 0) + (stats[s.id]?.hidden || 0);
    const ok = await confirm(
      `هتمسح المادة "${s.subject_name}" ومعاها ${n} درس نهائيًا. اللي اتنسخ للطلاب خلاص مبيتأثرش. متأكد؟`,
      { danger: true, confirmLabel: 'مسح المادة' }
    );
    if (!ok) return;
    const { error } = await supabase.from('catalog_subjects').delete().eq('id', s.id);
    if (error) { toast('تعذّر مسح المادة', 'error', error); return; }
    logAction({
      adminId: me?.id, adminName: me?.name || 'أدمن', action: 'catalog_subject_delete', targetType: 'catalog_subject', targetId: s.id,
      details: `مسح مادة "${s.subject_name}" (${s.system} • ${s.grade}) ومعاها ${n} درس`,
    });
    toast('اتمسحت المادة');
    if (openId === s.id) setOpenId(null);
    await loadSubjects();
    await loadStats();
  };

  if (loading) return <Spinner />;

  if (missing) {
    return (
      <div>
        <PageHeader eyebrow="إدارة المحتوى" title="دروس المنهج" />
        <EmptyState
          icon="⚙"
          title="لازم تشغّل ملف دروس المنهج الأول"
          hint="شغّل supabase_catalog_lessons.sql في Supabase (SQL Editor) وبعدها حدّث الصفحة. الملف بيعمل جدولين catalog_subjects (مواد كل تقسيم) و catalog_lessons (الدروس)."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="إدارة المحتوى"
        title="دروس المنهج"
        action={<button onClick={() => setDialog({ mode: 'add' })} className="btn-primary">إضافة مادة</button>}
      />
      <p className="text-sm text-muted mb-5 -mt-3">
        الدروس اللي بتضيفها هنا بتظهر للطلاب كزرار "ضيف دروس المنهج" في مادتهم. اللي اتنسخ لطالب خلاص مبيتأثرش بأي تعديل أو إخفاء أو مسح.
      </p>

      <CoverageCard subjects={subjects} stats={stats} />

      <div className="card p-4 mb-5 space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="النظام">
          {SYSTEMS.map((s) => <button key={s} onClick={() => pickSystem(s)} className={tabClass(system === s)}>{s}</button>)}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="الصف">
          {GRADES.map((g) => <button key={g} onClick={() => pickGrade(g)} className={tabClass(grade === g)}>{g}</button>)}
        </div>
        {hasTracks(grade) && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="الشعبة">
            {choices.map((t) => <button key={t ?? 'general'} onClick={() => pickTrack(t)} className={tabClass(track === t)}>{trackLabel(t)}</button>)}
          </div>
        )}
      </div>

      {dialog && (
        <SubjectDialog
          key={dialog.mode + (dialog.subject?.id || '')}
          mode={dialog.mode}
          subject={dialog.subject}
          defaults={{ system, grade, track }}
          subjects={subjects}
          onClose={() => setDialog(null)}
          onSaved={async () => { setDialog(null); await loadSubjects(); await loadStats(); }}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-5 items-start">
        <div className="card p-4">
          <p className="font-messiri font-bold mb-1">مواد التقسيم ({list.length})</p>
          {hasTracks(grade) && (
            <p className="text-xs text-muted mb-3">
              الطالب بيشوف مواد شعبته ومعاها «المواد العامة للصف». كل مجموعة ليها تبويب لوحده فوق.
            </p>
          )}
          {list.length === 0 ? (
            <p className="text-sm text-muted py-4">مفيش مواد في التقسيم ده. أضف مادة من زرار "إضافة مادة".</p>
          ) : (
            <ul className="divide-y divide-surface-line">
              {list.map((s) => {
                const st = stats[s.id] || { visible: 0, hidden: 0 };
                const empty = st.visible === 0;
                return (
                  <li key={s.id} className={`py-2.5 flex flex-wrap items-center gap-2 ${openId === s.id ? 'bg-accent/10 -mx-2 px-2 rounded-lg' : ''} ${empty ? 'border-r-4 border-amber pr-2' : ''}`}>
                    <button onClick={() => openEditor(s.id)} className="flex-1 min-w-[10rem] text-right">
                      <span className="block font-semibold text-sm break-words">{s.subject_name}</span>
                      <span className={`block text-xs ${empty ? 'text-amber-dark font-semibold' : 'text-muted'}`}>
                        {empty ? 'مفيش دروس ظاهرة' : `${st.visible} ظاهر`}{st.hidden > 0 ? ` · ${st.hidden} مخفي` : ''}
                      </span>
                    </button>
                    <span className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setDialog({ mode: 'edit', subject: s })} className="btn-ghost !px-2.5 !py-1 text-xs">تعديل</button>
                      <button onClick={() => removeSubject(s)} className="btn-ghost !px-2.5 !py-1 text-xs text-coral-dark">مسح</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div ref={editorRef}>
          {openSubject ? (
            <LessonsEditor
              key={openSubject.id}
              subject={openSubject}
              subjects={subjects}
              stats={stats}
              onChanged={loadStats}
              onClose={() => setOpenId(null)}
            />
          ) : (
            <div className="card p-6 text-center text-sm text-muted hidden xl:block">اختار مادة من القايمة عشان تعدّل دروسها.</div>
          )}
        </div>
      </div>
    </div>
  );
}
