import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, useToast } from '../components/UI';

const CONTACT_FIELDS = [
  { key: 'whatsapp', label: 'واتساب (رابط wa.me)' },
  { key: 'email', label: 'إيميل (mailto:...)' },
  { key: 'instagram', label: 'انستجرام' },
  { key: 'facebook', label: 'فيسبوك' },
  { key: 'telegram_group', label: 'جروب تليجرام' },
  { key: 'telegram_channel', label: 'قناة تليجرام' },
  { key: 'telegram_personal', label: 'تليجرام شخصي' },
];

async function readSetting(key, fallback) {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? fallback;
}

async function writeSetting(key, value) {
  return supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() });
}

function Section({ title, hint, children, onSave, saving }) {
  return (
    <div className="card p-5 mb-6 max-w-2xl">
      <p className="font-messiri font-bold mb-1">{title}</p>
      {hint && <p className="text-xs text-muted mb-4">{hint}</p>}
      {!hint && <div className="mb-4" />}
      {children}
      <button onClick={onSave} disabled={saving} className="btn-primary mt-4">
        {saving ? 'جارِ الحفظ...' : 'حفظ'}
      </button>
    </div>
  );
}

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // رسائل تحفيزية
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [savingMessages, setSavingMessages] = useState(false);

  // تواصل معنا
  const [contact, setContact] = useState({});
  const [savingContact, setSavingContact] = useState(false);

  // وضع الصيانة
  const [maintenance, setMaintenance] = useState({ enabled: false, message: '' });
  const [savingMaintenance, setSavingMaintenance] = useState(false);

  // إجبار التحديث
  const [minVersion, setMinVersion] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [savingVersion, setSavingVersion] = useState(false);

  // المساعد الذكي
  const AI_DEFAULTS = { enabled: false, daily_limit_per_user: 20, monthly_limit_global: 3000, model: 'gemini-2.5-flash-lite' };
  const [aiAssistant, setAiAssistant] = useState(AI_DEFAULTS);
  const [savingAi, setSavingAi] = useState(false);
  const [aiUsage, setAiUsage] = useState({ loading: true, count: null, error: false });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [msgs, contactLinks, maint, ver, ai] = await Promise.all([
        readSetting('focus_messages', []),
        readSetting('contact_links', {}),
        readSetting('maintenance', { enabled: false, message: '' }),
        readSetting('min_app_version', { android: '1.0.0', url: '' }),
        readSetting('ai_assistant', AI_DEFAULTS),
      ]);
      setMessages(Array.isArray(msgs) ? msgs : []);
      setContact(contactLinks || {});
      setMaintenance(maint || { enabled: false, message: '' });
      setMinVersion(ver?.android || '1.0.0');
      setDownloadUrl(ver?.url || '');
      setAiAssistant({ ...AI_DEFAULTS, ...(ai || {}) });
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke('admin-ai-usage', {
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        });
        if (error) throw error;
        setAiUsage({ loading: false, count: data?.message_count ?? 0, error: false });
      } catch {
        setAiUsage({ loading: false, count: null, error: true });
      }
    })();
  }, []);

  const addMessage = () => {
    const m = newMessage.trim();
    if (!m) return;
    setMessages((prev) => [...prev, m]);
    setNewMessage('');
  };

  const removeMessage = (i) => setMessages((prev) => prev.filter((_, idx) => idx !== i));

  const saveMessages = async () => {
    setSavingMessages(true);
    const { error } = await writeSetting('focus_messages', messages);
    setSavingMessages(false);
    if (error) { toast('تعذّر الحفظ', 'error'); return; }
    toast('تم حفظ الرسائل التحفيزية');
  };

  const saveContact = async () => {
    setSavingContact(true);
    const { error } = await writeSetting('contact_links', contact);
    setSavingContact(false);
    if (error) { toast('تعذّر الحفظ', 'error'); return; }
    toast('تم حفظ بيانات التواصل');
  };

  const saveMaintenance = async () => {
    setSavingMaintenance(true);
    const { error } = await writeSetting('maintenance', maintenance);
    setSavingMaintenance(false);
    if (error) { toast('تعذّر الحفظ', 'error'); return; }
    toast(maintenance.enabled ? 'تم تفعيل وضع الصيانة' : 'تم إيقاف وضع الصيانة');
  };

  const saveVersion = async () => {
    const version = minVersion.trim();
    const url = downloadUrl.trim();

    // رقم الإصدار لازم يكون بالشكل x.y.z (زي 1.2.0) عشان مقارنة الإصدارات
    // جوه التطبيق تشتغل صح — أي شكل تاني ممكن يلخبط المقارنة
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      toast('رقم الإصدار لازم يكون بالشكل ده بالظبط: 1.2.0', 'error');
      return;
    }

    // الرابط لازم يكون رابط حقيقي (http/https) أو فاضي تمامًا — أي نص تاني
    // (مسافة، رابط ناقص، إلخ) هيوصّل المستخدمين لشاشة تحديث بزرار متعطّل
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
      } catch {
        toast('رابط التحميل غير صحيح — لازم يبدأ بـ https://', 'error');
        return;
      }
    }

    setSavingVersion(true);
    const { error } = await writeSetting('min_app_version', { android: version, url });
    setSavingVersion(false);
    if (error) { toast('تعذّر الحفظ', 'error'); return; }
    if (!url) {
      toast('تم الحفظ — لكن رابط التحميل فاضي، فزرار "تحديث الآن" هيفشل لأي مستخدم يوصله. حط الرابط قبل ما تفعّل إصدار أعلى من نسخته', 'error');
      return;
    }
    toast('تم حفظ أقل إصدار مسموح');
  };

  const saveAi = async () => {
    const dailyLimit = Number(aiAssistant.daily_limit_per_user);
    const monthlyLimit = Number(aiAssistant.monthly_limit_global);
    const model = (aiAssistant.model || '').trim();

    if (!Number.isInteger(dailyLimit) || dailyLimit <= 0) {
      toast('الحد اليومي لكل طالب لازم يكون رقم صحيح أكبر من صفر', 'error');
      return;
    }
    if (!Number.isInteger(monthlyLimit) || monthlyLimit <= 0) {
      toast('السقف الشهري الإجمالي لازم يكون رقم صحيح أكبر من صفر', 'error');
      return;
    }
    if (!model) {
      toast('اسم الموديل مينفعش يبقى فاضي', 'error');
      return;
    }

    setSavingAi(true);
    const { error } = await writeSetting('ai_assistant', {
      enabled: aiAssistant.enabled,
      daily_limit_per_user: dailyLimit,
      monthly_limit_global: monthlyLimit,
      model,
    });
    setSavingAi(false);
    if (error) { toast('تعذّر الحفظ', 'error'); return; }
    setAiAssistant({ enabled: aiAssistant.enabled, daily_limit_per_user: dailyLimit, monthly_limit_global: monthlyLimit, model });
    toast(aiAssistant.enabled ? 'تم حفظ إعدادات المساعد الذكي — الميزة مفعّلة' : 'تم حفظ إعدادات المساعد الذكي');
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader eyebrow="إعدادات تتحكم في التطبيق مباشرة" title="إعدادات التطبيق" />

      <Section
        title="وضع الصيانة"
        hint="لو فعّلته، هيتمنع كل المستخدمين من الدخول للتطبيق ويشوفوا الرسالة دي بس"
        onSave={saveMaintenance}
        saving={savingMaintenance}
      >
        <label className="flex items-center gap-3 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={maintenance.enabled}
            onChange={(e) => setMaintenance({ ...maintenance, enabled: e.target.checked })}
            className="w-5 h-5 accent-coral"
          />
          <span className="font-semibold text-sm">تفعيل وضع الصيانة الآن</span>
        </label>
        <textarea
          value={maintenance.message}
          onChange={(e) => setMaintenance({ ...maintenance, message: e.target.value })}
          rows={2}
          placeholder="مثال: التطبيق تحت الصيانة حاليًا، هنرجع خلال ساعة إن شاء الله 🛠️"
          className="input-field"
        />
      </Section>

      <Section
        title="إجبار التحديث"
        hint="أي مستخدم بإصدار أقل من ده هيتمنع من استخدام التطبيق لحد ما يحدّث"
        onSave={saveVersion}
        saving={savingVersion}
      >
        <label className="text-xs text-muted font-semibold">أقل إصدار مسموح</label>
        <input
          value={minVersion}
          onChange={(e) => setMinVersion(e.target.value)}
          placeholder="مثال: 1.2.0"
          className="input-field max-w-xs mt-1 mb-3"
        />
        <label className="text-xs text-muted font-semibold">رابط تحميل النسخة الجديدة</label>
        <input
          value={downloadUrl}
          onChange={(e) => setDownloadUrl(e.target.value)}
          placeholder="رابط تحميل الـ APK مباشرة (مش رابط جوجل بلاي، التطبيق مش عليه)"
          className="input-field mt-1"
        />
      </Section>

      <Section
        title="المساعد الذكي"
        hint="التحكم في مساعد الذكاء الاصطناعي جوه التطبيق وحدود استخدامه"
        onSave={saveAi}
        saving={savingAi}
      >
        <label className="flex items-center gap-3 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={aiAssistant.enabled}
            onChange={(e) => setAiAssistant({ ...aiAssistant, enabled: e.target.checked })}
            className="w-5 h-5 accent-coral"
          />
          <span className="font-semibold text-sm">تفعيل المساعد الذكي</span>
        </label>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-muted font-semibold">الحد اليومي الافتراضي لكل طالب</label>
            <input
              type="number"
              min="1"
              value={aiAssistant.daily_limit_per_user}
              onChange={(e) => setAiAssistant({ ...aiAssistant, daily_limit_per_user: e.target.value })}
              className="input-field mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted font-semibold">السقف الشهري الإجمالي</label>
            <input
              type="number"
              min="1"
              value={aiAssistant.monthly_limit_global}
              onChange={(e) => setAiAssistant({ ...aiAssistant, monthly_limit_global: e.target.value })}
              className="input-field mt-1"
            />
            <p className="text-xs text-muted mt-1">حد إجمالي لكل الطلاب مجتمعين، مش لكل طالب لوحده</p>
          </div>
        </div>

        <label className="text-xs text-muted font-semibold">اسم الموديل</label>
        <input
          value={aiAssistant.model}
          onChange={(e) => setAiAssistant({ ...aiAssistant, model: e.target.value })}
          className="input-field mt-1"
        />
        <p className="text-xs text-muted mt-1 mb-4">بيسمح بتغيير المزوّد لاحقًا من غير تحديث تطبيق</p>

        <div className="bg-parchment rounded-xl px-3 py-2.5">
          <p className="text-xs text-muted font-semibold mb-1">الاستهلاك الشهري الحالي</p>
          {aiUsage.loading ? (
            <p className="text-sm text-muted">جارِ التحميل...</p>
          ) : aiUsage.error ? (
            <p className="text-sm text-coral-dark">تعذّر تحميل الاستهلاك — تأكد إن Edge Function "admin-ai-usage" متنشورة (راجع README)</p>
          ) : (
            <p className="text-sm font-semibold">
              {aiUsage.count.toLocaleString('en-US')} / {(Number(aiAssistant.monthly_limit_global) || 0).toLocaleString('en-US')} رسالة
            </p>
          )}
        </div>
      </Section>

      <Section
        title="بيانات تواصل معنا"
        hint="الروابط اللي بتظهر في شاشة تواصل معنا جوه التطبيق"
        onSave={saveContact}
        saving={savingContact}
      >
        <div className="grid grid-cols-2 gap-3">
          {CONTACT_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="text-xs text-muted font-semibold">{f.label}</label>
              <input
                value={contact[f.key] || ''}
                onChange={(e) => setContact({ ...contact, [f.key]: e.target.value })}
                className="input-field mt-1"
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="الرسائل التحفيزية"
        hint="بتتاخد منها 8 رسائل عشوائية يوميًا كإشعارات أثناء المذاكرة"
        onSave={saveMessages}
        saving={savingMessages}
      >
        <div className="flex gap-2 mb-3">
          <input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addMessage()}
            placeholder="أضف رسالة تحفيزية جديدة"
            className="input-field"
          />
          <button onClick={addMessage} className="btn-ghost shrink-0">إضافة</button>
        </div>
        {messages.length === 0 ? (
          <p className="text-sm text-muted">مفيش رسائل مخصصة — التطبيق هيستخدم القائمة الافتراضية المكتوبة في كوده</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {messages.map((m, i) => (
              <div key={i} className="flex items-center justify-between gap-2 bg-parchment rounded-xl px-3 py-2">
                <p className="text-sm">{m}</p>
                <button onClick={() => removeMessage(i)} className="text-muted hover:text-coral font-bold shrink-0">×</button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
