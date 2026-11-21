import { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useToast } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { GRADES, SYSTEMS, cleanTrack, hasTracks, reconcileTrack, tracksFor } from '../../lib/divisions';
import { trackLabel, validateSubjectForm } from '../../lib/catalog';
import { DEFAULT_UNIT_LABEL, LABEL_SUGGESTIONS, UNIT_LABEL_MAX, validateUnitLabel } from '../../lib/catalogUnits';

// إضافة مادة (النظام والصف والشعبة من القوايم الحرفية + الاسم) أو تعديل اسمها وترتيبها
// (التقسيم نفسه مبيتغيّرش بعد الإنشاء، مسّح وأضف من جديد لو غلط).
export default function SubjectDialog({ mode, subject, defaults, subjects, supportsUnits = false, onClose, onSaved }) {
  const toast = useToast();
  const me = useAppUser();
  const editing = mode === 'edit';
  const [system, setSystem] = useState(editing ? subject.system : defaults.system);
  const [grade, setGrade] = useState(editing ? subject.grade : defaults.grade);
  const [track, setTrack] = useState(editing ? cleanTrack(subject.track) : cleanTrack(defaults.track));
  const [name, setName] = useState(editing ? subject.subject_name : '');
  const sameCombo = subjects.filter((s) => s.system === system && s.grade === grade && cleanTrack(s.track) === track);
  const [order, setOrder] = useState(editing ? String(subject.sort_order ?? 1) : String(sameCombo.reduce((m, s) => Math.max(m, s.sort_order || 0), 0) + 1));
  const [unitLabel, setUnitLabel] = useState(editing ? subject.unit_label || DEFAULT_UNIT_LABEL : DEFAULT_UNIT_LABEL);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const others = editing ? subjects.filter((s) => s.id !== subject.id) : subjects;
    const problem = validateSubjectForm({ system, grade, track, name }, others);
    const sortNum = Number(order);
    const orderProblem = !Number.isInteger(sortNum) || sortNum < 0 ? 'الترتيب لازم يكون رقم صحيح' : null;
    const labelProblem = supportsUnits ? validateUnitLabel(unitLabel) : null;
    setError(problem || orderProblem || labelProblem || '');
    if (problem || orderProblem || labelProblem) return;
    setSaving(true);
    const row = { subject_name: name.trim(), sort_order: sortNum, ...(supportsUnits ? { unit_label: unitLabel.trim() } : {}) };
    const { error: err } = editing
      ? await supabase.from('catalog_subjects').update(row).eq('id', subject.id)
      : await supabase.from('catalog_subjects').insert({ system, grade, track, ...row });
    setSaving(false);
    if (err) { toast(editing ? 'تعذّر تعديل المادة' : 'تعذّر إضافة المادة', 'error', err); return; }
    logAction({
      adminId: me?.id, adminName: me?.name || 'أدمن', action: editing ? 'catalog_subject_edit' : 'catalog_subject_add', targetType: 'catalog_subject', targetId: editing ? subject.id : null,
      details: editing ? `تعديل مادة "${subject.subject_name}" ← "${row.subject_name}" (ترتيب ${sortNum}${supportsUnits && row.unit_label !== (subject.unit_label || DEFAULT_UNIT_LABEL) ? `، مسمى الوحدات "${row.unit_label}"` : ''})` : `إضافة مادة "${row.subject_name}" (${system} • ${grade}${track ? ` • ${track}` : ''})`,
    });
    toast(editing ? 'اتعدّلت المادة' : 'اتضافت المادة');
    onSaved();
  };

  const tracks = tracksFor(system, grade);

  return (
    <div className="card p-5 mb-5 border-accent/40">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="font-messiri font-bold">{editing ? `تعديل مادة: ${subject.subject_name}` : 'إضافة مادة'}</p>
        <button onClick={onClose} className="btn-ghost !px-3 !py-1.5 text-sm shrink-0">إلغاء</button>
      </div>
      <div className="bg-amber/10 border border-amber/40 rounded-xl p-3 mb-4 text-sm text-muted">
        <b className="text-amber-dark">اسم المادة لازم يطابق اسمها في التطبيق بالظبط</b> (التطابق بيتجاهل الهمزات والتشكيل بس). مادة الطالب لو اتغيّر اسمها مش هتاخد دروس.
      </div>

      {editing ? (
        <p className="text-sm text-muted mb-3">{subject.system} • {subject.grade} • {trackLabel(subject.track)}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="text-xs text-muted font-semibold" htmlFor="sub-system">النظام</label>
            <select id="sub-system" value={system} onChange={(e) => { setSystem(e.target.value); setTrack(reconcileTrack(e.target.value, grade, track)); }} className="input-field mt-1">
              {SYSTEMS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted font-semibold" htmlFor="sub-grade">الصف</label>
            <select id="sub-grade" value={grade} onChange={(e) => { setGrade(e.target.value); setTrack(reconcileTrack(system, e.target.value, track)); }} className="input-field mt-1">
              {GRADES.map((g) => <option key={g}>{g}</option>)}
            </select>
          </div>
          {hasTracks(grade) && (
            <div>
              <label className="text-xs text-muted font-semibold" htmlFor="sub-track">الشعبة</label>
              <select id="sub-track" value={track ?? ''} onChange={(e) => setTrack(cleanTrack(e.target.value))} className="input-field mt-1">
                <option value="">مواد عامة للصف (من غير شعبة)</option>
                {tracks.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_8rem] gap-3 mb-3">
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="sub-name">اسم المادة</label>
          <input id="sub-name" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} className="input-field mt-1" />
        </div>
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="sub-order">الترتيب</label>
          <input id="sub-order" value={order} onChange={(e) => setOrder(e.target.value)} inputMode="numeric" dir="ltr" className="input-field mt-1 text-left" />
        </div>
      </div>
      {supportsUnits && (
        <div className="mb-3">
          <label className="text-xs text-muted font-semibold" htmlFor="sub-unit-label">مسمى الوحدات في المادة دي</label>
          <input
            id="sub-unit-label"
            value={unitLabel}
            maxLength={UNIT_LABEL_MAX}
            onChange={(e) => { setUnitLabel(e.target.value); setError(''); }}
            className="input-field mt-1 max-w-xs"
          />
          <div className="flex flex-wrap gap-2 mt-2">
            {LABEL_SUGGESTIONS.map((l) => (
              <button key={l} type="button" onClick={() => setUnitLabel(l)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${unitLabel.trim() === l ? 'bg-ink text-accent border-ink' : 'bg-white text-muted border-surface-line hover:text-ink'}`}>{l}</button>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-1.5">بيظهر في عناوين الوحدات: الباب الأول، الوحدة الثانية، Unit 2. التغيير بيوصل التطبيق في أول مزامنة.</p>
        </div>
      )}
      {error && <p className="text-sm text-coral-dark font-semibold mb-2" role="alert">{error}</p>}
      <button onClick={save} disabled={saving} className="btn-primary !px-5 !py-2 text-sm">{saving ? 'بيتحفظ...' : editing ? 'حفظ التعديل' : 'إضافة المادة'}</button>
    </div>
  );
}
