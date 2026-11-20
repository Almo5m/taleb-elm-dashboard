import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Spinner, useToast } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { fetchSetting, writeSetting } from '../../lib/appSettings';
import { buildChain, modelNameProblem, normalizeModelName, validateModelList } from '../../lib/aiModels';
import ModelChainEditor from './ModelChainEditor';
import AiPricingSection from './AiPricingSection';

const SETTING_KEY = 'ai_assistant';
const AI_DEFAULTS = {
  enabled: false, auto_enable_new: false, daily_limit_per_user: 20, monthly_limit_global: 3000,
  model: 'gemini-2.5-flash-lite', fallback_models: [],
};

// حاسبة السعة: السقف الشهري الإجمالي ثابت، فكل ما المفعّل لهم زادوا، السقف بيخلص أسرع.
// الحسبة لأسوأ حالة (كل طالب بيستخدم حده اليومي كله). الاستخدام الفعلي غالبًا أقل بكتير، فراقب الاستهلاك الشهري.
function AiCapacity({ counts, daily, monthly, autoEnable }) {
  if (counts.enabled === null || !daily || !monthly) return null;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const worstPerDay = counts.enabled * daily;
  const days = worstPerDay > 0 ? monthly / worstPerDay : null;
  const allStudentsPerDay = (counts.students ?? 0) * daily;
  const daysAll = allStudentsPerDay > 0 ? monthly / allStudentsPerDay : null;
  const tight = (d) => d !== null && d < 30;

  return (
    <div className="bg-surface rounded-xl px-3 py-2.5 mt-3 text-sm">
      <p className="text-xs text-muted font-semibold mb-1">حاسبة السعة (أسوأ حالة)</p>
      <p>
        المفعّل لهم دلوقتي <span className="font-semibold">{fmt(counts.enabled)}</span> من {fmt(counts.students ?? 0)} طالب.
        لو كلهم استخدموا الحد اليومي ({fmt(daily)}) يبقى <span className="font-semibold">{fmt(worstPerDay)}</span> رسالة في اليوم.
      </p>
      {days !== null && (
        <p className={`mt-1 ${tight(days) ? 'text-coral-dark font-semibold' : 'text-muted'}`}>
          السقف الشهري ({fmt(monthly)}) يخلص بعد حوالي {days < 1 ? 'أقل من يوم' : `${days.toFixed(1)} يوم`} في أسوأ حالة.
          {tight(days) && ' لو الاستخدام الفعلي قريب من الحد، ارفع السقف أو قلّل الحد اليومي.'}
        </p>
      )}
      {(autoEnable || (counts.students ?? 0) > counts.enabled) && daysAll !== null && counts.students > counts.enabled && (
        <p className={`mt-1 ${tight(daysAll) ? 'text-coral-dark' : 'text-muted'}`}>
          لو فعّلته لكل الطلاب ({fmt(counts.students)}): السقف يخلص بعد حوالي {daysAll < 1 ? 'أقل من يوم' : `${daysAll.toFixed(1)} يوم`} في أسوأ حالة.
        </p>
      )}
    </div>
  );
}

// تبويب "الإعدادات" في صفحة المساعد الذكي: التفعيل والحدود والموديلات (إعداد ai_assistant)، وبعدها أسعار الموديلات.
export default function AiSettingsPanel() {
  const toast = useToast();
  const me = useAppUser();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [ai, setAi] = useState(AI_DEFAULTS);
  const [saved, setSaved] = useState({ model: AI_DEFAULTS.model, fallback_models: [] }); // المحفوظ فعلًا، عشان نعرف إيه اللي اتغيّر
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState({ loading: true, count: null, error: false });
  const [counts, setCounts] = useState({ students: null, enabled: null });

  const load = async () => {
    setLoading(true);
    const result = await fetchSetting(SETTING_KEY);
    if (result.error) { setLoadError(result.error); setLoading(false); return; } // مانعرضش قيم افتراضية: الحفظ بعدها كان هيمسح الحقيقية
    setLoadError(null);
    const loaded = { ...AI_DEFAULTS, ...(result.value || {}) };
    loaded.fallback_models = Array.isArray(loaded.fallback_models) ? loaded.fallback_models.filter((m) => typeof m === 'string') : [];
    setAi(loaded);
    setSaved({ model: loaded.model, fallback_models: loaded.fallback_models });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke('admin-ai-usage', {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        });
        if (error) throw error;
        setUsage({ loading: false, count: data?.message_count ?? 0, error: false });
      } catch {
        setUsage({ loading: false, count: null, error: true });
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const [students, enabled] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student').eq('banned', false),
        supabase.from('ai_access').select('*', { count: 'exact', head: true }).eq('enabled', true),
      ]);
      if (students.error || enabled.error) {
        toast('تعذّر حساب أعداد الطلاب لحاسبة المساعد الذكي', 'error', students.error || enabled.error);
        return;
      }
      setCounts({ students: students.count ?? 0, enabled: enabled.count ?? 0 });
    })();
  }, [toast]);

  const set = (patch) => setAi((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    const dailyLimit = Number(ai.daily_limit_per_user);
    const monthlyLimit = Number(ai.monthly_limit_global);
    const model = (ai.model || '').trim();

    if (!Number.isInteger(dailyLimit) || dailyLimit <= 0) { toast('الحد اليومي لكل طالب لازم يكون رقم صحيح أكبر من صفر', 'error'); return; }
    if (!Number.isInteger(monthlyLimit) || monthlyLimit <= 0) { toast('السقف الشهري الإجمالي لازم يكون رقم صحيح أكبر من صفر', 'error'); return; }
    const modelProblem = modelNameProblem(model);
    if (modelProblem) { toast(modelProblem, 'error'); return; }
    const fallbackCheck = validateModelList(ai.fallback_models, { primary: model });
    if (fallbackCheck.error) { toast(`الموديلات البديلة: ${fallbackCheck.error}`, 'error'); return; }

    setSaving(true);
    // بنحتفظ بأي حقول تانية في الإعداد بدل ما نمسحها
    const payload = {
      ...ai,
      auto_enable_new: !!ai.auto_enable_new,
      daily_limit_per_user: dailyLimit,
      monthly_limit_global: monthlyLimit,
      model: normalizeModelName(model),
      fallback_models: fallbackCheck.cleaned,
    };
    const { error } = await writeSetting(SETTING_KEY, payload);
    setSaving(false);
    if (error) { toast('تعذّر الحفظ', 'error', error); return; }

    const before = buildChain(saved.model, saved.fallback_models);
    const after = buildChain(payload.model, payload.fallback_models);
    setAi(payload);
    setSaved({ model: payload.model, fallback_models: payload.fallback_models });
    if (before.join() !== after.join()) {
      logAction({ adminId: me?.id, adminName: me?.name || 'أدمن', action: 'ai_models_update', targetType: 'app_settings', targetId: SETTING_KEY, details: { from: before, to: after } });
    }
    toast(ai.enabled ? 'تم حفظ إعدادات المساعد الذكي — الميزة مفعّلة' : 'تم حفظ إعدادات المساعد الذكي');
  };

  if (loading) return <Spinner />;

  if (loadError) {
    return (
      <div className="card p-6 max-w-xl">
        <p className="font-messiri font-bold text-coral-dark mb-1">الإعدادات ماتحمّلتش صح</p>
        <p className="text-sm text-muted mb-3">مخبّيها عشان ماتحفظش قيم افتراضية فوق الحقيقية. أعد المحاولة.</p>
        <button type="button" className="btn-primary" onClick={load}>إعادة المحاولة</button>
      </div>
    );
  }

  return (
    <div>
      <div className="card p-5 mb-6 max-w-2xl">
        <p className="font-messiri font-bold mb-1">التحكم والحدود</p>
        <p className="text-xs text-muted mb-4">التحكم في مساعد الذكاء الاصطناعي جوه التطبيق وحدود استخدامه</p>

        <label className="flex items-center gap-3 mb-4 cursor-pointer">
          <input type="checkbox" checked={ai.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="w-5 h-5 accent-coral" />
          <span className="font-semibold text-sm">تفعيل المساعد الذكي</span>
        </label>

        <label className="flex items-start gap-3 mb-4 cursor-pointer">
          <input type="checkbox" checked={!!ai.auto_enable_new} onChange={(e) => set({ auto_enable_new: e.target.checked })} className="w-5 h-5 accent-coral mt-0.5" />
          <span>
            <span className="font-semibold text-sm block">تفعيل المساعد تلقائيًا للطلاب الجدد</span>
            <span className="text-xs text-muted block mt-0.5">
              أي طالب يسجّل من دلوقتي بيتفعّل له المساعد من غير ما تدخل له. الطلاب الحاليين من صفحة الحسابات (تحديد ← تفعيل).
              محتاج تشغّل ملف sql/supabase_ai_auto_enable.sql مرة واحدة في Supabase.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-muted font-semibold" htmlFor="ai-daily">الحد اليومي الافتراضي لكل طالب</label>
            <input id="ai-daily" type="number" min="1" value={ai.daily_limit_per_user} onChange={(e) => set({ daily_limit_per_user: e.target.value })} className="input-field mt-1" />
          </div>
          <div>
            <label className="text-xs text-muted font-semibold" htmlFor="ai-monthly">السقف الشهري الإجمالي</label>
            <input id="ai-monthly" type="number" min="1" value={ai.monthly_limit_global} onChange={(e) => set({ monthly_limit_global: e.target.value })} className="input-field mt-1" />
            <p className="text-xs text-muted mt-1">حد إجمالي لكل الطلاب مجتمعين، مش لكل طالب لوحده</p>
          </div>
        </div>

        <div className="bg-surface rounded-xl px-3 py-2.5">
          <p className="text-xs text-muted font-semibold mb-1">الاستهلاك الشهري الحالي</p>
          {usage.loading ? (
            <p className="text-sm text-muted">جارِ التحميل...</p>
          ) : usage.error ? (
            <p className="text-sm text-coral-dark">تعذّر تحميل الاستهلاك — تأكد إن Edge Function "admin-ai-usage" متنشورة (راجع README)</p>
          ) : (
            <p className="text-sm font-semibold">{usage.count.toLocaleString('en-US')} / {(Number(ai.monthly_limit_global) || 0).toLocaleString('en-US')} رسالة</p>
          )}
        </div>
        <AiCapacity counts={counts} daily={Number(ai.daily_limit_per_user)} monthly={Number(ai.monthly_limit_global)} autoEnable={!!ai.auto_enable_new} />

        <hr className="border-surface-line my-5" />

        <p className="font-messiri font-bold mb-1">الموديلات</p>
        <p className="text-xs text-amber-dark bg-amber/10 border border-amber/30 rounded-lg px-2.5 py-2 mb-4">
          الحصة المجانية عند جوجل بتختلف من موديل لموديل (بعض الموديلات حدها ٢٠ طلب في اليوم لكل المشروع). شوف الحدود الفعلية من Google AI Studio ← Rate limit.
          الأفضل الأساسي يكون موديل حصته اليومية كبيرة، والأقوى يتحط بعده كبديل.
        </p>

        <label className="text-xs text-muted font-semibold" htmlFor="ai-model">الموديل الأساسي</label>
        <input id="ai-model" value={ai.model} onChange={(e) => set({ model: e.target.value })} dir="ltr" className="input-field mt-1 mb-4 text-left" />

        <p className="text-xs text-muted font-semibold mb-1">الموديلات البديلة</p>
        <p className="text-[11px] text-muted mb-2">الترتيب = الأولوية. بو بيبدأ بالأساسي ولو حصته خلصت بيكمّل على اللي بعده.</p>
        <ModelChainEditor
          id="ai-fallbacks"
          value={ai.fallback_models}
          onChange={(fallback_models) => set({ fallback_models })}
          primary={ai.model}
          emptyText="مفيش بدائل. لو حصة الأساسي خلصت بو هيقف عند الطلاب."
        />

        <button type="button" onClick={save} disabled={saving} className="btn-primary mt-5">
          {saving ? 'جارِ الحفظ...' : 'حفظ'}
        </button>
      </div>

      <AiPricingSection knownModels={buildChain(saved.model, saved.fallback_models)} />
    </div>
  );
}
