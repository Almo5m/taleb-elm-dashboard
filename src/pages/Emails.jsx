import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState, useToast, useConfirm } from '../components/UI';

const GRADES = ['الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];
const STATUS_TONE = { pending: 'gold', sent: 'forest', failed: 'coral' };
const STATUS_LABEL = { pending: 'معلّق / مجدول', sent: 'اتبعت', failed: 'فشل' };
const TARGET_LABEL = { all: 'كل الطلاب', grade: 'صف معيّن', single_user: 'طالب واحد' };

export default function Emails() {
  const toast = useToast();
  const confirm = useConfirm();

  const [log, setLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(true);

  const [targetType, setTargetType] = useState('all');
  const [targetGrade, setTargetGrade] = useState(GRADES[0]);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadLog();
  }, []);

  const loadLog = async () => {
    setLoadingLog(true);
    const { data, error } = await supabase
      .from('scheduled_emails')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) console.error('Emails log error:', error);
    setLog(data || []);
    setLoadingLog(false);
  };

  useEffect(() => {
    if (targetType !== 'single_user' || !userQuery.trim()) {
      setUserResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, name, email')
        .or(`name.ilike.%${userQuery}%,email.ilike.%${userQuery}%`)
        .limit(8);
      setUserResults(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [userQuery, targetType]);

  const send = async () => {
    if (!subject.trim() || !body.trim()) {
      toast('اكتب العنوان والنص الأول', 'error');
      return;
    }
    if (targetType === 'single_user' && !selectedUser) {
      toast('اختار طالب الأول', 'error');
      return;
    }

    const confirmMsg = scheduleAt
      ? `متأكد إنك عايز تجدول الإيميل ده لـ ${TARGET_LABEL[targetType]}؟`
      : `متأكد إنك عايز تبعت الإيميل ده دلوقتي لـ ${TARGET_LABEL[targetType]}؟`;
    const ok = await confirm(confirmMsg, { danger: true, confirmLabel: scheduleAt ? 'جدولة' : 'إرسال الآن' });
    if (!ok) return;

    setSending(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('send-email', {
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      body: {
        subject: subject.trim(),
        body: body.trim(),
        target_type: targetType,
        target_grade: targetType === 'grade' ? targetGrade : undefined,
        target_user_id: targetType === 'single_user' ? selectedUser?.id : undefined,
        scheduled_at: scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
      },
    });
    setSending(false);

    if (error) {
      const context = await error.context?.json?.().catch(() => null);
      toast(context?.error || error.message, 'error');
      loadLog();
      return;
    }

    if (data?.scheduled) {
      toast('اتجدول الإيميل بنجاح', 'success');
    } else {
      toast(`اتبعت لـ ${data.sent} من ${data.total}${data.failed ? ` (فشل ${data.failed})` : ''}`, 'success');
    }

    setSubject('');
    setBody('');
    setScheduleAt('');
    setSelectedUser(null);
    setUserQuery('');
    loadLog();
  };

  return (
    <div>
      <PageHeader eyebrow="تواصل" title="الإيميلات" />
      <div className="card p-4 mb-6 bg-gold/10 border border-gold/30">
        <p className="text-sm">
          ⚠️ الميزة دي متوقفة مؤقتًا لحد ما يتجهّز دومين خاص بالتطبيق (Resend محتاج دومين موثّق
          عشان يبعت لإيميلات حقيقية). أي إرسال دلوقتي هيفشل أو يوصل لإيميلك انت بس (وضع اختبار).
        </p>
      </div>
      <p className="text-xs text-muted mb-6 -mt-2">
        بيتبعت إيميل منفصل لكل طالب (مش رسالة واحدة فيها كل الإيميلات) — إيميل أي طالب ميظهرش للتاني
      </p>

      <div className="card p-6 max-w-2xl mb-6">
        <p className="font-messiri font-bold mb-4">إيميل جديد</p>

        <div className="flex gap-2 mb-4">
          {Object.entries(TARGET_LABEL).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTargetType(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                targetType === key ? 'bg-ink text-gold' : 'bg-parchment text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {targetType === 'grade' && (
          <select value={targetGrade} onChange={(e) => setTargetGrade(e.target.value)} className="input-field mb-4">
            {GRADES.map((g) => <option key={g}>{g}</option>)}
          </select>
        )}

        {targetType === 'single_user' && (
          <div className="relative mb-4">
            <input
              value={selectedUser ? `${selectedUser.name} — ${selectedUser.email}` : userQuery}
              onChange={(e) => { setUserQuery(e.target.value); setSelectedUser(null); }}
              placeholder="دوّر بالاسم أو الإيميل"
              className="input-field"
            />
            {userResults.length > 0 && !selectedUser && (
              <div className="absolute z-10 w-full bg-white border border-parchment-line rounded-lg mt-1 shadow-lg max-h-48 overflow-y-auto">
                {userResults.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { setSelectedUser(u); setUserResults([]); }}
                    className="w-full text-right px-3 py-2 hover:bg-parchment/60 text-sm"
                  >
                    <p className="font-semibold">{u.name}</p>
                    <p className="text-xs text-muted">{u.email}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="عنوان الإيميل"
          className="input-field mb-3"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="نص الإيميل (بيدعم HTML بسيط)"
          rows={5}
          className="input-field mb-3"
        />

        <label className="text-xs text-muted block mb-1">جدولة (اختياري — سيبه فاضي للإرسال فورًا)</label>
        <input
          type="datetime-local"
          value={scheduleAt}
          onChange={(e) => setScheduleAt(e.target.value)}
          className="input-field mb-4"
        />

        <button onClick={send} disabled={sending} className="btn-primary w-full">
          {sending ? 'جارِ التنفيذ...' : scheduleAt ? 'جدولة الإيميل' : 'إرسال الآن'}
        </button>
      </div>

      <p className="font-messiri font-bold mb-3">آخر 20 إيميل</p>
      {loadingLog ? (
        <Spinner />
      ) : log.length === 0 ? (
        <EmptyState icon="✉" title="مفيش إيميلات اتبعتت لسه" />
      ) : (
        <div className="card divide-y divide-parchment-line overflow-hidden">
          {log.map((e) => (
            <div key={e.id} className="flex items-center gap-4 p-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{e.subject}</p>
                <p className="text-[11px] text-muted mt-1">
                  {TARGET_LABEL[e.target_type]}{e.target_grade ? ` — ${e.target_grade}` : ''}
                  {e.scheduled_at ? ` — مجدول لـ ${new Date(e.scheduled_at).toLocaleString('ar-EG')}` : ''}
                  {e.status === 'sent' && ` — اتبعت لـ ${e.sent_count}${e.failed_count ? ` (فشل ${e.failed_count})` : ''}`}
                  {e.error_message && ` — ${e.error_message}`}
                </p>
              </div>
              <Stamp tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Stamp>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
