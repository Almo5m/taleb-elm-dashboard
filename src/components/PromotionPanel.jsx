import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { CopyButton, Stamp, useToast } from './UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';
import { exportToCsv } from '../lib/csv';
import { FIRST_GRADE, SECOND_GRADE, SYSTEMS, hasTracks } from '../lib/divisions';

// ترقية جماعية "نقل الصفوف". القواعد والتنفيذ في SQL (sql/supabase_division_promotion.sql) عشان:
//   - المعاينة والتنفيذ ياخدوا نفس القواعد بالظبط (مصدر واحد)
//   - التنفيذ معاملة واحدة: يا كله يا مفيش، ولو العدد اتغيّر بعد المعاينة بيتلغي
// الخطوات: معاينة ← تنزيل نسخة احتياطية CSV ← كتابة كلمة التأكيد ← تنفيذ.

export const CONFIRM_WORD = 'ترقية';

const rpcMissing = (error) =>
  error && (error.code === '42883' || error.code === 'PGRST202' || /could not find the function|does not exist/i.test(error.message || ''));

export default function PromotionPanel({ onDone, onClose }) {
  const toast = useToast();
  const me = useAppUser();
  const [system, setSystem] = useState('');
  const [fromGrade, setFromGrade] = useState(SECOND_GRADE);
  const [preview, setPreview] = useState(null); // { rows, total, skipped }
  const [loading, setLoading] = useState(false);
  const [backupCount, setBackupCount] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [running, setRunning] = useState(false);
  const [missing, setMissing] = useState(false);

  const args = () => ({ p_system: system || null, p_from_grade: fromGrade });
  const reset = () => { setPreview(null); setBackupCount(null); setConfirmText(''); };

  const loadPreview = async () => {
    setLoading(true);
    reset();
    const { data, error } = await supabase.rpc('admin_promotion_preview', args());
    setLoading(false);
    if (rpcMissing(error)) { setMissing(true); return; }
    if (error) { toast('تعذّرت المعاينة', 'error', error); return; }
    setMissing(false);
    const rows = data || [];
    setPreview({
      rows,
      total: rows.filter((r) => !r.skipped).reduce((s, r) => s + Number(r.students), 0),
      skipped: rows.filter((r) => r.skipped).reduce((s, r) => s + Number(r.students), 0),
    });
  };

  const downloadBackup = async () => {
    const { data, error } = await supabase.rpc('admin_promotion_students', args());
    if (error) { toast('تعذّر تجهيز النسخة الاحتياطية', 'error', error); return; }
    const rows = data || [];
    exportToCsv(
      `نسخة-قبل-الترقية-${fromGrade}-${new Date().toISOString().slice(0, 10)}.csv`,
      rows,
      [{ key: 'id', label: 'id' }, { key: 'system', label: 'النظام' }, { key: 'grade', label: 'الصف' }, { key: 'track', label: 'الشعبة' }]
    );
    setBackupCount(rows.length);
    if (preview && rows.length !== preview.total) {
      toast('عدد الطلاب اتغيّر بعد المعاينة. اعمل معاينة جديدة وانزّل النسخة تاني', 'error');
      reset();
    }
  };

  const canRun = !!preview && preview.total > 0 && backupCount === preview.total && confirmText.trim() === CONFIRM_WORD && !running;

  const run = async () => {
    if (!canRun) return;
    setRunning(true);
    const { data, error } = await supabase.rpc('admin_promote_students', { ...args(), p_expected: preview.total });
    setRunning(false);
    if (error) {
      if (/count_mismatch/.test(error.message || '')) {
        toast('الأعداد اتغيّرت بعد المعاينة، فماحصلش أي تغيير. اعمل معاينة جديدة', 'error', error);
        reset();
      } else {
        toast('تعذّر تنفيذ الترقية. ماحصلش أي تغيير', 'error', error);
      }
      return;
    }
    const moved = typeof data === 'number' ? data : preview.total;
    logAction({
      adminId: me?.id, adminName: me?.name || 'أدمن', action: 'bulk_promotion', targetType: 'profile', targetId: null,
      details: `ترقية ${moved} طالب من ${fromGrade}${system ? ` (${system})` : ' (كل الأنظمة)'}`,
    });
    toast(`تمت ترقية ${moved} طالب`);
    reset();
    onDone?.(moved);
  };

  const fromLabel = (r) => `${r.system || '—'}${r.from_track ? ` • ${r.from_track}` : ''}`;
  const toLabel = (r) => {
    if (r.skipped) return 'مش مشمول';
    if (!r.to_track && hasTracks(r.to_grade)) return `${r.to_grade} • من غير شعبة (يختارها من التطبيق)`;
    return `${r.to_grade}${r.to_track ? ` • ${r.to_track}` : ''}`;
  };

  return (
    <div className="card p-5 mb-6 border-accent/40">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-messiri font-bold text-lg">نقل الصفوف (ترقية جماعية)</p>
          <p className="text-xs text-muted">معاينة، ثم نسخة احتياطية، ثم تنفيذ في معاملة واحدة.</p>
        </div>
        <button onClick={onClose} className="btn-ghost !px-3 !py-1.5 text-sm shrink-0">إغلاق</button>
      </div>

      <div className="bg-amber/10 border border-amber/40 rounded-xl p-3 mb-4 text-sm space-y-1">
        <p className="font-semibold text-amber-dark">قبل ما تبدأ</p>
        <ul className="list-disc pr-5 space-y-0.5 text-muted">
          <li>نفّذ الترقية <b>بعد</b> نزول نسخة التطبيق الخاصة بالسنة الجديدة وفرض التحديث (شعب الأزهر الجديدة في الثاني هتختلف).</li>
          <li><b>الترتيب:</b> انقل «الثاني ← الثالث» الأول، وبعدين «الأول ← الثاني». لو عكست، اللي اتنقل من الأول هيتنقل تاني.</li>
          <li>الصف الثالث مبيتحركش (بيتخرج). بيتنقل الطلاب بس (مش المشرفين) واللي نظامهم من القايمة الرسمية.</li>
          <li>الأول ← الثاني: الشعبة بتتصفّر. الثاني ← الثالث: «علمي» في الثانوية العامة بتتصفّر، و«أدبي» والبكالوريا والأزهر بتفضل.</li>
        </ul>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="promo-system">النظام</label>
          <select id="promo-system" value={system} onChange={(e) => { setSystem(e.target.value); reset(); }} className="input-field mt-1">
            <option value="">كل الأنظمة</option>
            {SYSTEMS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted font-semibold" htmlFor="promo-grade">النقل من</label>
          <select id="promo-grade" value={fromGrade} onChange={(e) => { setFromGrade(e.target.value); reset(); }} className="input-field mt-1">
            <option value={SECOND_GRADE}>الصف الثاني ← الثالث</option>
            <option value={FIRST_GRADE}>الصف الأول ← الثاني</option>
          </select>
        </div>
      </div>
      <button onClick={loadPreview} disabled={loading} className="btn-primary !px-4 !py-2 text-sm mb-4">
        {loading ? 'بيحسب...' : 'معاينة'}
      </button>

      {missing && (
        <p className="text-sm text-coral-dark font-semibold mb-3" role="alert">
          لازم تشغّل ملف sql/supabase_division_promotion.sql في Supabase الأول.
        </p>
      )}

      {preview && (
        <div className="space-y-4">
          {preview.rows.length === 0 ? (
            <p className="text-sm text-muted">مفيش طلاب مطابقين للفلتر ده.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted text-right text-xs">
                    <th className="font-semibold pb-1 pl-3">من</th>
                    <th className="font-semibold pb-1 pl-3">إلى</th>
                    <th className="font-semibold pb-1">الطلاب</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} className={`border-t border-surface-line align-top ${r.skipped ? 'text-muted' : ''}`}>
                      <td className="py-1.5 pl-3">{fromLabel(r)}</td>
                      <td className="py-1.5 pl-3">{toLabel(r)}</td>
                      <td className="py-1.5 font-semibold">{r.students}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm">
            إجمالي المتأثرين: <span className="font-bold">{preview.total}</span>
            {preview.skipped > 0 && (
              <span className="text-muted"> · {preview.skipped} غير مشمولين (نظامهم مش من القايمة الرسمية، صحّحهم بـ supabase_division_fix.sql)</span>
            )}
          </p>

          {preview.total > 0 && (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={downloadBackup} className="btn-ghost !px-4 !py-2 text-sm">1) تنزيل نسخة احتياطية CSV</button>
                {backupCount === preview.total && <Stamp tone="forest">اتنزّلت ({backupCount} طالب)</Stamp>}
              </div>
              <div>
                <label className="text-xs text-muted font-semibold" htmlFor="promo-confirm">
                  2) اكتب كلمة «{CONFIRM_WORD}» للتأكيد
                </label>
                <input
                  id="promo-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  disabled={backupCount !== preview.total}
                  placeholder={backupCount === preview.total ? CONFIRM_WORD : 'نزّل النسخة الاحتياطية الأول'}
                  className="input-field mt-1 sm:w-64"
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={run} disabled={!canRun} className="btn-danger !px-5 !py-2 text-sm">
                  {running ? 'بينفّذ...' : `3) نفّذ الترقية لـ ${preview.total} طالب`}
                </button>
                <CopyButton
                  text={() => preview.rows.map((r) => `${fromLabel(r)} ← ${toLabel(r)}: ${r.students}`).join('\n')}
                  label="نسخ المعاينة"
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
