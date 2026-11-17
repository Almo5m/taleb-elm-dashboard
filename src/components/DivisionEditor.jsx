import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Stamp, useToast, useConfirm } from './UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';
import { GRADES, SYSTEMS, cleanTrack, divisionLabel, divisionStatus, hasTracks, reconcileTrack, tracksFor } from '../lib/divisions';

// تعديل نظام وصف وشعبة طالب واحد من قوايم مقيّدة (من src/lib/divisions.js). ممنوع كتابة حرة.
// الطالب مبيقدرش يغيّر ده بنفسه (السيرفر بيرفض: supabase_profile_division_lock.sql)، والأدمن بس.
export default function DivisionEditor({ profile, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();

  const current = { system: profile.system || '', grade: profile.grade || '', track: cleanTrack(profile.track) };
  const currentStatus = divisionStatus(current);
  const [system, setSystem] = useState(SYSTEMS.includes(current.system) ? current.system : '');
  const [grade, setGrade] = useState(GRADES.includes(current.grade) ? current.grade : '');
  const [track, setTrack] = useState(reconcileTrack(current.system, current.grade, current.track));
  const [saving, setSaving] = useState(false);

  const tracks = tracksFor(system, grade);
  const next = { system, grade, track: cleanTrack(track) };
  // الشعبة اختيارية في الصف اللي فيه تشعيب (فاضية = الطالب هيختارها من التطبيق)، وممنوعة في الأول
  const complete = !!system && !!grade && (hasTracks(grade) ? next.track === null || tracks.includes(next.track) : next.track === null);
  const changed = next.system !== current.system || next.grade !== current.grade || next.track !== current.track;

  const changeSystem = (value) => { setSystem(value); setTrack(reconcileTrack(value, grade, track)); };
  const changeGrade = (value) => { setGrade(value); setTrack(reconcileTrack(system, value, track)); };

  const save = async () => {
    if (!complete || !changed || saving) return;
    const ok = await confirm(
      `هتغيّر تقسيم "${profile.name || 'الطالب'}" من:\n${divisionLabel(current)}\nإلى:\n${divisionLabel(next)}${hasTracks(grade) && next.track === null ? '\n(من غير شعبة: الطالب هيختارها من التطبيق)' : ''}`,
      { confirmLabel: 'تأكيد التغيير' }
    );
    if (!ok) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update(next).eq('id', profile.id);
    setSaving(false);
    if (error) { toast('تعذّر تغيير التقسيم', 'error', error); return; }
    logAction({
      adminId: me?.id, adminName: me?.name || 'أدمن', action: 'student_division_update', targetType: 'profile', targetId: profile.id,
      details: `تقسيم ${profile.name || profile.id}: ${divisionLabel(current)} ← ${divisionLabel(next)}`,
    });
    toast('اتغيّر التقسيم الدراسي');
    onSaved?.(next);
  };

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <p className="font-messiri font-bold">التقسيم الدراسي</p>
        {currentStatus === 'valid' && <Stamp tone="forest">مطابق</Stamp>}
        {currentStatus === 'pending' && <Stamp tone="amber">في انتظار اختيار الشعبة</Stamp>}
        {currentStatus === 'invalid' && <Stamp tone="coral">مش من الجدول الرسمي</Stamp>}
      </div>
      <p className="text-xs text-muted mb-4">
        الطالب مبيقدرش يغيّر نظامه وصفه وشعبته بنفسه، التغيير من هنا بس. أول فتحة للتطبيق بعد التغيير بتضيف مواد التقسيم الجديد الناقصة من غير ما تمسح مواده القديمة.
      </p>
      {currentStatus === 'invalid' && (
        <p className="text-sm text-coral-dark mb-3" role="alert">
          التقسيم الحالي: {divisionLabel(current)}. اختار القيم الصح من القوايم.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="div-system">النظام</label>
          <select id="div-system" value={system} onChange={(e) => changeSystem(e.target.value)} className="input-field mt-1">
            <option value="">— اختار —</option>
            {SYSTEMS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="div-grade">الصف</label>
          <select id="div-grade" value={grade} onChange={(e) => changeGrade(e.target.value)} className="input-field mt-1">
            <option value="">— اختار —</option>
            {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        {hasTracks(grade) && (
          <div>
            <label className="text-xs text-muted font-semibold" htmlFor="div-track">الشعبة / المسار</label>
            <select id="div-track" value={track ?? ''} onChange={(e) => setTrack(cleanTrack(e.target.value))} className="input-field mt-1" disabled={!system}>
              <option value="">من غير شعبة (الطالب يختارها)</option>
              {tracks.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      <button onClick={save} disabled={!complete || !changed || saving} className="btn-primary">
        {saving ? 'جارِ الحفظ...' : 'حفظ التقسيم'}
      </button>
    </div>
  );
}
