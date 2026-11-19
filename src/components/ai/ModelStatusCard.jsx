import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Spinner, Stamp, useToast } from '../UI';
import { isMissingRelation } from '../../lib/clientErrors';
import { allUnavailable, buildChain, earliestReturn, formatCairoTime, modelStatusRows } from '../../lib/aiModels';

const REFRESH_MS = 60 * 1000;

// حالة موديلات بو: السلسلة المحفوظة بترتيبها، وأنهي موديل خالص ولحد إمتى (من جدول ai_model_state).
// بتتحدّث لوحدها كل دقيقة والصفحة ظاهرة. primary و fallbacks هنا القيم المحفوظة فعلًا، مش اللي بتتعدّل.
export default function ModelStatusCard({ primary, fallbacks }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, missing: false, rows: [], at: null });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    const { data, error } = await supabase.from('ai_model_state').select('model, exhausted_until, reason, detail, updated_at');
    if (manual) setRefreshing(false);
    if (error) {
      if (isMissingRelation(error)) { setState({ loading: false, missing: true, rows: [], at: null }); return; }
      toast('تعذّر تحميل حالة الموديلات', 'error', error);
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }
    setState({ loading: false, missing: false, rows: data || [], at: Date.now() });
  }, [toast]);

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const chain = buildChain(primary, fallbacks);
  const rows = modelStatusRows(chain, state.rows);
  const stopped = allUnavailable(rows);
  const returnAt = earliestReturn(rows);

  return (
    <div className="card p-5 mb-6 max-w-2xl">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-messiri font-bold">حالة موديلات بو</p>
          <p className="text-xs text-muted mt-0.5">بو بيجرّب الموديلات بالترتيب، ولو حصة موديل خلصت بيكمّل على اللي بعده.</p>
        </div>
        <button type="button" onClick={() => load(true)} disabled={refreshing} className="btn-ghost !px-3 !py-1.5 text-xs shrink-0">
          {refreshing ? 'جارِ التحديث...' : 'تحديث'}
        </button>
      </div>

      {state.loading ? (
        <Spinner />
      ) : state.missing ? (
        <div className="bg-amber/10 border border-amber/40 rounded-xl p-3 text-sm">
          شغّل ملف <span className="font-mono" dir="ltr">sql/supabase_ai_model_state.sql</span> في Supabase SQL Editor عشان الحالة تظهر هنا.
        </div>
      ) : (
        <>
          {stopped && (
            <div className="bg-coral/10 border border-coral/40 rounded-xl p-3 mb-3 text-sm text-coral-dark font-semibold" role="alert">
              بو واقف عند الطلاب{returnAt ? ` لحد ${formatCairoTime(returnAt)}` : ''}. كل الموديلات في السلسلة خالصة.
            </div>
          )}
          <ol className="space-y-2">
            {rows.map((row, i) => (
              <li key={row.model} className="flex items-start gap-3 bg-surface rounded-xl px-3 py-2.5">
                <span className="w-5 text-center text-xs text-muted font-semibold pt-0.5 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono truncate" dir="ltr">{row.model}</p>
                  {!row.available && (
                    <p className="text-xs text-muted mt-0.5">
                      {row.reasonLabel} · لحد {formatCairoTime(row.until)}
                    </p>
                  )}
                  {!row.available && row.detail && (
                    <p className="text-[11px] text-muted/80 mt-0.5 break-words line-clamp-2" dir="auto">{row.detail}</p>
                  )}
                </div>
                {row.available ? <Stamp tone="forest">متاح</Stamp> : <Stamp tone="coral">خالص</Stamp>}
              </li>
            ))}
          </ol>
          {state.at && (
            <p className="text-[11px] text-muted mt-3">
              آخر تحديث {new Date(state.at).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' })} بتوقيت القاهرة
            </p>
          )}
        </>
      )}
    </div>
  );
}
