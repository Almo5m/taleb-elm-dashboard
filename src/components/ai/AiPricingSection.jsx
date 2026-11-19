import { useEffect, useState } from 'react';
import { Spinner, useToast } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { fetchSetting, writeSetting } from '../../lib/appSettings';
import { EMPTY_PRICING, pricingToRows, validatePricing } from '../../lib/aiPlans';
import { isValidModelName } from '../../lib/aiModels';

const SETTING_KEY = 'ai_pricing';

// أسعار الموديلات بالدولار لكل مليون توكن + سعر الدولار بالجنيه (app_settings.ai_pricing).
// بتستخدمها بس "التكلفة التقديرية" في الرئيسية. موديل من غير سعر هنا بيظهر "غير مسعّر" مش صفر.
export default function AiPricingSection({ knownModels = [] }) {
  const toast = useToast();
  const me = useAppUser();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [usd, setUsd] = useState('');
  const [rows, setRows] = useState([]);
  const [saved, setSaved] = useState(EMPTY_PRICING);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await fetchSetting(SETTING_KEY);
    if (result.error) { setLoadError(result.error); setLoading(false); return; }
    setLoadError(null);
    setUsd(result.value?.usd_to_egp ? String(result.value.usd_to_egp) : '');
    setRows(pricingToRows(result.value));
    setSaved(result.value || EMPTY_PRICING);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const setRow = (i, patch) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = (model = '') => setRows((prev) => [...prev, { model, input_per_m: '', output_per_m: '' }]);
  const unpricedKnown = knownModels.filter((m) => isValidModelName(m) && !rows.some((r) => r.model.trim() === m));

  const save = async () => {
    const { error, value } = validatePricing({ usdToEgp: usd, rows });
    if (error) { toast(error, 'error'); return; }
    setSaving(true);
    const { error: writeError } = await writeSetting(SETTING_KEY, value);
    setSaving(false);
    if (writeError) { toast('تعذّر حفظ أسعار الموديلات', 'error', writeError); return; }
    setSaved(value);
    setRows(pricingToRows(value));
    logAction({
      adminId: me?.id,
      adminName: me?.name || 'أدمن',
      action: 'ai_pricing_update',
      targetType: 'app_settings',
      targetId: SETTING_KEY,
      details: { from: saved, to: value },
    });
    toast('تم حفظ أسعار الموديلات');
  };

  return (
    <div className="card p-5 mb-6 max-w-2xl">
      <p className="font-messiri font-bold mb-1">أسعار الموديلات (للتكلفة التقديرية)</p>
      <p className="text-xs text-muted mb-4">
        بتحسب بيها كارت "اشتراكات بو" في الرئيسية. الأسعار بالدولار لكل مليون توكن.
        <b className="text-amber-dark"> راجع الأرقام من صفحة أسعار جوجل الرسمية، لأنها بتتغيّر.</b>
      </p>

      {loading ? (
        <Spinner />
      ) : loadError ? (
        <div className="bg-coral/10 border border-coral/40 rounded-xl p-3 text-sm">
          <p className="text-coral-dark font-semibold mb-2">تعذّر تحميل الأسعار، فمخبّيها عشان ماتحفظش فوق القيم الحقيقية.</p>
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={load}>إعادة المحاولة</button>
        </div>
      ) : (
        <>
          <label className="text-xs text-muted font-semibold" htmlFor="ai-usd">سعر الدولار بالجنيه</label>
          <input
            id="ai-usd"
            type="number"
            min="0"
            step="any"
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
            className="input-field max-w-[10rem] mt-1 mb-4"
          />

          {rows.length === 0 ? (
            <p className="text-sm text-muted mb-3">مفيش أسعار لسه. من غيرها كل الموديلات هتظهر "غير مسعّرة" والتكلفة هتتعرض ناقصة.</p>
          ) : (
            <div className="space-y-2 mb-3">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_auto] gap-2 items-end bg-surface rounded-xl p-2.5">
                  <div>
                    <label className="text-[11px] text-muted font-semibold" htmlFor={`pm-${i}`}>الموديل</label>
                    <input id={`pm-${i}`} value={row.model} onChange={(e) => setRow(i, { model: e.target.value })} dir="ltr" className="input-field mt-0.5 text-left" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted font-semibold" htmlFor={`pi-${i}`}>إدخال $</label>
                    <input id={`pi-${i}`} type="number" min="0" step="any" value={row.input_per_m} onChange={(e) => setRow(i, { input_per_m: e.target.value })} className="input-field mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted font-semibold" htmlFor={`po-${i}`}>إخراج $</label>
                    <input id={`po-${i}`} type="number" min="0" step="any" value={row.output_per_m} onChange={(e) => setRow(i, { output_per_m: e.target.value })} className="input-field mt-0.5" />
                  </div>
                  <button type="button" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))} aria-label={`احذف سعر ${row.model || 'الموديل'}`} className="text-muted hover:text-coral font-bold px-2 pb-2">×</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-1">
            <button type="button" onClick={() => addRow()} className="btn-ghost !px-3 !py-1.5 text-xs">+ موديل</button>
            {unpricedKnown.map((m) => (
              <button key={m} type="button" onClick={() => addRow(m)} className="btn-ghost !px-3 !py-1.5 text-xs font-mono" dir="ltr">+ {m}</button>
            ))}
          </div>

          <button type="button" onClick={save} disabled={saving} className="btn-primary mt-4">
            {saving ? 'جارِ الحفظ...' : 'حفظ'}
          </button>
        </>
      )}
    </div>
  );
}
