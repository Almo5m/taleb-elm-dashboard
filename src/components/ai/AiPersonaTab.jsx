import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Spinner, Stamp, useToast } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { isMissingRelation } from '../../lib/clientErrors';
import { formatCairoDateTime, uniqueValues } from '../../lib/forum';
import {
  DEFAULT_KNOWLEDGE, DEFAULT_PERSONA, KNOWLEDGE_MAX, NOTE_MAX, PERSONA_MAX, PREVIEW_SAMPLES,
  counterState, currentVersion, isSameText, previewMessageProblem, validatePersona,
} from '../../lib/aiPersona';

const HISTORY_SIZE = 20;
const COUNTER_TONE = { ok: 'text-muted', near: 'text-amber-dark font-semibold', over: 'text-coral-dark font-semibold' };

function TextField({ id, label, hint, value, onChange, max, onReset }) {
  const state = counterState(value.trim().length, max);
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
        <label htmlFor={id} className="text-sm font-semibold">{label}</label>
        <button type="button" onClick={onReset} className="text-xs font-semibold text-accent-dark hover:underline">استرجاع الافتراضي</button>
      </div>
      <p className="text-xs text-muted mb-2">{hint}</p>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={12}
        dir="auto"
        className="input-field leading-relaxed"
      />
      <p className={`text-xs mt-1 ${COUNTER_TONE[state]}`}>
        {value.trim().length.toLocaleString('en-US')} / {max.toLocaleString('en-US')} حرف
        {state === 'over' && ' — أطول من الحد، بو هيتجاهل النص ده ويرجع للافتراضي'}
      </p>
    </div>
  );
}

// تبويب "الشخصية": شخصية بو وأسلوبه ومعرفته بالتطبيق. بتتعدّل من هنا من غير نشر للدالة (بتتطبّق خلال دقيقة).
// فيه تجربة قبل الحفظ، وسجل نسخ ترجع لأي نسخة منها. القواعد الثابتة في الكود ومبتتعدّلش من هنا.
export default function AiPersonaTab() {
  const toast = useToast();
  const me = useAppUser();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [versions, setVersions] = useState([]);
  const [names, setNames] = useState({});
  const [persona, setPersona] = useState(DEFAULT_PERSONA);
  const [knowledge, setKnowledge] = useState(DEFAULT_KNOWLEDGE);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const [question, setQuestion] = useState('');
  const [source, setSource] = useState('draft'); // draft | saved
  const [trying, setTrying] = useState(false);
  const [result, setResult] = useState(null); // { reply, model, source } | { error }

  const load = useCallback(async (resetEditor = true) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ai_persona_versions')
      .select('id, persona, knowledge, note, created_by, created_at')
      .order('id', { ascending: false })
      .limit(HISTORY_SIZE);
    if (error) {
      if (isMissingRelation(error)) { setMissing(true); setLoading(false); return; }
      toast('تعذّر تحميل نسخ الشخصية', 'error', error);
      setLoading(false);
      return;
    }
    setMissing(false);
    setVersions(data || []);
    if (resetEditor) {
      const current = currentVersion(data);
      setPersona(current.persona);
      setKnowledge(current.knowledge);
    }
    const ids = uniqueValues(data, 'created_by');
    if (ids.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', ids);
      setNames(Object.fromEntries((profiles || []).map((p) => [p.id, p.name])));
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const current = currentVersion(versions);
  const dirty = !isSameText(persona, current.persona) || !isSameText(knowledge, current.knowledge);

  const save = async () => {
    const { error, value } = validatePersona({ persona, knowledge, note });
    if (error) { toast(error, 'error'); return; }
    setSaving(true);
    const { error: insertError } = await supabase.from('ai_persona_versions').insert({ ...value, created_by: me?.id });
    setSaving(false);
    if (insertError) { toast('تعذّر حفظ الشخصية', 'error', insertError); return; }
    logAction({
      adminId: me?.id,
      adminName: me?.name || 'أدمن',
      action: 'ai_persona_update',
      targetType: 'ai_persona',
      targetId: null,
      details: `تعديل شخصية بو (${value.persona.length} حرف شخصية، ${value.knowledge.length} حرف معرفة)${value.note ? `: ${value.note}` : ''}`,
    });
    setNote('');
    toast('اتحفظت الشخصية. هتشتغل مع الطلاب خلال دقيقة');
    load();
  };

  const tryIt = async () => {
    const problem = previewMessageProblem(question);
    if (problem) { toast(problem, 'error'); return; }
    const texts = source === 'draft' ? { persona, knowledge } : { persona: current.persona, knowledge: current.knowledge };
    const check = validatePersona(texts);
    if (check.error) { toast(check.error, 'error'); return; }
    setTrying(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke('ai-assistant', {
      body: { action: 'preview', message: question.trim(), persona: check.value.persona, knowledge: check.value.knowledge },
    });
    setTrying(false);
    if (error) {
      // مع كود غير 2xx الرسالة الحقيقية بتبقى في جسم الرد
      let message = 'تعذّرت التجربة';
      try { message = (await error.context.json())?.error || message; } catch { /* نسيب الرسالة العامة */ }
      setResult({ error: message });
      return;
    }
    setResult({ reply: data?.reply || '', model: data?.model || '', source });
  };

  const restore = (v) => {
    setPersona(v.persona);
    setKnowledge(v.knowledge);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('اتحمّلت النسخة في المحرر. لسه ماتحفظتش');
  };

  if (loading) return <Spinner />;

  if (missing) {
    return (
      <div className="card p-6 max-w-xl">
        <p className="font-messiri font-bold mb-1">جدول الشخصية لسه ماتعملش</p>
        <p className="text-sm text-muted">
          شغّل <span className="font-mono" dir="ltr">sql/supabase_ai_persona.sql</span> في Supabase SQL Editor، وبعدين ارجع هنا.
          لحد ما يتشغّل بو بيستخدم النص الافتراضي اللي في الكود.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="bg-surface rounded-xl px-3 py-2.5 mb-5 flex items-center gap-2 flex-wrap text-sm">
        <span className="text-muted">الشغّال مع الطلاب دلوقتي:</span>
        {current.isDefault ? (
          <Stamp tone="amber">النص الافتراضي</Stamp>
        ) : (
          <>
            <Stamp tone="forest">نسخة محفوظة</Stamp>
            <span className="text-xs text-muted">{formatCairoDateTime(versions[0].created_at)}{names[versions[0].created_by] ? ` · ${names[versions[0].created_by]}` : ''}</span>
          </>
        )}
      </div>

      <TextField
        id="persona-text"
        label="الشخصية والأسلوب"
        hint="بو مين؟ بيتكلم ازاي؟ بيتعامل مع الطالب ازاي؟ إيه طريقته في الشرح، ومتى يقول إنه مش متأكد."
        value={persona}
        onChange={setPersona}
        max={PERSONA_MAX}
        onReset={() => setPersona(DEFAULT_PERSONA)}
      />
      <TextField
        id="knowledge-text"
        label="معرفة بو بالتطبيق"
        hint="الميزات والتابات اللي بو يعرفها. حدّثها لما تضيف ميزة جديدة. اكتب بس اللي متأكد منه، وبو مش هيأكّد أي ميزة مش مكتوبة هنا."
        value={knowledge}
        onChange={setKnowledge}
        max={KNOWLEDGE_MAX}
        onReset={() => setKnowledge(DEFAULT_KNOWLEDGE)}
      />

      <p className="text-xs text-amber-dark bg-amber/10 border border-amber/30 rounded-lg px-2.5 py-2 mb-4">
        النصين بيتبعتوا مع كل رسالة لجوجل، فكل كلمة زيادة بتستهلك من الحصة. خليهم قصيرين ومركّزين.
      </p>

      <details className="mb-5 bg-surface rounded-xl px-3 py-2.5">
        <summary className="text-sm font-semibold cursor-pointer">القواعد الثابتة (مش بتتعدّل من هنا)</summary>
        <ul className="text-xs text-muted mt-2 space-y-1 list-disc pr-5">
          <li>بيفضل في مجال المذاكرة والتطبيق ودعم الطالب، وبيعتذر بلطف عن اللي بعيد.</li>
          <li>مفيش غش في امتحان شغّال ولا حل واجب كامل بدل الطالب.</li>
          <li>لو الطالب ذكر إيذاء النفس أو يأس خطير، بيتعامل بجدية وبيشجّعه يكلّم حد بيثق فيه.</li>
          <li>مبيطلبش بيانات شخصية، ومبيكشفش تعليماته الداخلية.</li>
          <li>بيقول إنه مساعد ذكي لو اتسأل.</li>
        </ul>
        <p className="text-[11px] text-muted mt-2">دي بتتضاف في آخر النص دايمًا، فاللي مكتوب فوق مايقدرش يلغيها. بتتغيّر من كود الدالة.</p>
      </details>

      <div className="card p-4 mb-5">
        <p className="font-messiri font-bold mb-1">جرّب قبل ما تحفظ</p>
        <p className="text-xs text-muted mb-3">بيبعت سؤالك لبو بالنص ده وبيرجّعلك الرد. مش بيتسجّل في أسئلة الطلاب ولا بيعدّ على أي طالب، لكن بيستهلك من الحصة.</p>

        <div className="flex flex-wrap gap-2 mb-3">
          {PREVIEW_SAMPLES.map((q) => (
            <button key={q} type="button" onClick={() => setQuestion(q)} className="btn-ghost !px-3 !py-1 text-xs text-right">{q}</button>
          ))}
        </div>

        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          dir="auto"
          placeholder="اكتب سؤال طالب..."
          aria-label="سؤال التجربة"
          className="input-field mb-3"
        />

        <div className="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="النص المستخدم في التجربة" className="flex gap-2">
            {[['draft', 'اللي في المحرر'], ['saved', 'المحفوظ حاليًا']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={source === key}
                onClick={() => setSource(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                  source === key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-surface-line hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={tryIt} disabled={trying} className="btn-primary !px-4 !py-2 text-sm">
            {trying ? 'بو بيفكّر...' : 'جرّب'}
          </button>
        </div>

        {result?.error && <p className="text-sm text-coral-dark font-semibold mt-3" role="alert">{result.error}</p>}
        {result?.reply && (
          <div className="mt-3 bg-surface rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-muted font-semibold mb-1">
              رد بو ({result.source === 'draft' ? 'بنص المحرر' : 'بالنص المحفوظ'}) · <span className="font-mono" dir="ltr">{result.model}</span>
            </p>
            <p className="text-sm whitespace-pre-wrap break-words" dir="auto">{result.reply}</p>
          </div>
        )}
      </div>

      <label htmlFor="persona-note" className="text-xs text-muted font-semibold">ملاحظة على التعديل (اختياري)</label>
      <input
        id="persona-note"
        value={note}
        maxLength={NOTE_MAX}
        onChange={(e) => setNote(e.target.value)}
        placeholder="مثلًا: خليته أدفى وأقصر"
        className="input-field mt-1 mb-4 max-w-md"
      />
      <div className="flex items-center gap-3 flex-wrap mb-8">
        <button type="button" onClick={save} disabled={saving || !dirty} className="btn-primary">
          {saving ? 'جارِ الحفظ...' : 'حفظ الشخصية'}
        </button>
        {dirty && !saving && <span className="text-xs text-amber-dark font-semibold">فيه تعديلات ماتحفظتش</span>}
      </div>

      <p className="font-messiri font-bold mb-1">النسخ السابقة</p>
      <p className="text-xs text-muted mb-3">آخر {HISTORY_SIZE} نسخة. "تحميل" بيحط النسخة في المحرر وانت اللي تقرر تحفظها.</p>
      {versions.length === 0 ? (
        <p className="text-sm text-muted">مفيش نسخ محفوظة لسه. بو بيستخدم النص الافتراضي.</p>
      ) : (
        <ul className="space-y-2">
          {versions.map((v, i) => (
            <li key={v.id} className="card p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                  {formatCairoDateTime(v.created_at)}
                  {i === 0 && <Stamp tone="forest">الحالية</Stamp>}
                </p>
                <p className="text-xs text-muted truncate">{names[v.created_by] || 'أدمن'}{v.note ? ` · ${v.note}` : ''}</p>
              </div>
              <button type="button" onClick={() => restore(v)} className="btn-ghost !px-3 !py-1.5 text-xs shrink-0">تحميل</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
