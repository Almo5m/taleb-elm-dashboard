import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState, useToast, useConfirm } from '../components/UI';

const STATUS_TONE = { pending: 'gold', sent: 'forest', failed: 'coral' };
const STATUS_LABEL = { pending: 'معلّق', sent: 'اتبعت', failed: 'فشل' };

export default function Notifications() {
  const toast = useToast();
  const confirm = useConfirm();

  const [log, setLog] = useState([]);
  const [loadingLog, setLoadingLog] = useState(true);

  // إشعار عام
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  // إشعار لمستخدم واحد
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [singleTitle, setSingleTitle] = useState('');
  const [singleBody, setSingleBody] = useState('');
  const [sendingSingle, setSendingSingle] = useState(false);

  useEffect(() => {
    loadLog();
  }, []);

  const loadLog = async () => {
    setLoadingLog(true);
    const { data, error } = await supabase
      .from('push_notifications_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(20);
    if (error) console.error('Notifications log error:', error);
    setLog(data || []);
    setLoadingLog(false);
  };

  useEffect(() => {
    if (!userQuery.trim()) {
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
  }, [userQuery]);

  const callSendFunction = async (body) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      body,
    });
    if (error) {
      // supabase-js بيرمي error هنا لو الفنكشن رجعت status غير 2xx (زي 403/502)
      const context = await error.context?.json?.().catch(() => null);
      return { error: context?.error || error.message };
    }
    return data;
  };

  const sendBroadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastBody.trim()) {
      toast('اكتب العنوان والنص الأول', 'error');
      return;
    }
    const ok = await confirm('متأكد إنك عايز تبعت الإشعار ده لكل المستخدمين؟ الفعل ده مالوش رجوع بعد الإرسال.', {
      danger: true,
      confirmLabel: 'إرسال للكل',
    });
    if (!ok) return;

    setSendingBroadcast(true);
    const result = await callSendFunction({
      title: broadcastTitle.trim(),
      body: broadcastBody.trim(),
      target_type: 'all',
    });
    setSendingBroadcast(false);

    if (result?.error) {
      toast(result.error, 'error');
    } else {
      toast(`اتبعت لـ ${result.sent} من ${result.total} جهاز${result.failed ? ` (فشل ${result.failed})` : ''}`, 'success');
      setBroadcastTitle('');
      setBroadcastBody('');
    }
    loadLog();
  };

  const sendSingle = async () => {
    if (!selectedUser) {
      toast('اختار طالب الأول', 'error');
      return;
    }
    if (!singleTitle.trim() || !singleBody.trim()) {
      toast('اكتب العنوان والنص الأول', 'error');
      return;
    }
    setSendingSingle(true);
    const result = await callSendFunction({
      title: singleTitle.trim(),
      body: singleBody.trim(),
      target_type: 'single_user',
      target_user_id: selectedUser.id,
    });
    setSendingSingle(false);

    if (result?.error) {
      toast(result.error, 'error');
    } else {
      toast(`اتبعت لـ ${result.sent} من ${result.total} جهاز${result.failed ? ` (فشل ${result.failed})` : ''}`, 'success');
      setSingleTitle('');
      setSingleBody('');
      setSelectedUser(null);
      setUserQuery('');
    }
    loadLog();
  };

  return (
    <div>
      <PageHeader eyebrow="تواصل" title="الإشعارات" />

      <div className="grid md:grid-cols-2 gap-5 mb-6">
        <div className="card p-6">
          <p className="font-messiri font-bold mb-1">إشعار عام لكل المستخدمين</p>
          <p className="text-xs text-muted mb-4">هيوصل لكل جهاز مسجّل توكن</p>
          <input
            value={broadcastTitle}
            onChange={(e) => setBroadcastTitle(e.target.value)}
            placeholder="العنوان (مثال: تحديث جديد 🎉)"
            className="input-field mb-3"
          />
          <textarea
            value={broadcastBody}
            onChange={(e) => setBroadcastBody(e.target.value)}
            placeholder="نص الإشعار"
            rows={3}
            className="input-field mb-3"
          />
          <button onClick={sendBroadcast} disabled={sendingBroadcast} className="btn-primary w-full">
            {sendingBroadcast ? 'جارِ الإرسال...' : 'إرسال لكل المستخدمين'}
          </button>
        </div>

        <div className="card p-6">
          <p className="font-messiri font-bold mb-1">إشعار لمستخدم واحد</p>
          <p className="text-xs text-muted mb-4">مفيد لدعم فردي أو تحفيز طالب معيّن</p>

          <div className="relative mb-3">
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

          <input
            value={singleTitle}
            onChange={(e) => setSingleTitle(e.target.value)}
            placeholder="العنوان"
            className="input-field mb-3"
          />
          <textarea
            value={singleBody}
            onChange={(e) => setSingleBody(e.target.value)}
            placeholder="نص الإشعار"
            rows={3}
            className="input-field mb-3"
          />
          <button onClick={sendSingle} disabled={sendingSingle} className="btn-primary w-full">
            {sendingSingle ? 'جارِ الإرسال...' : 'إرسال لهذا المستخدم بس'}
          </button>
        </div>
      </div>

      <p className="font-messiri font-bold mb-3">آخر 20 إشعار</p>
      {loadingLog ? (
        <Spinner />
      ) : log.length === 0 ? (
        <EmptyState icon="◇" title="مفيش إشعارات اتبعتت لسه" />
      ) : (
        <div className="card divide-y divide-parchment-line overflow-hidden">
          {log.map((n) => (
            <div key={n.id} className="flex items-center gap-4 p-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{n.title}</p>
                <p className="text-xs text-muted truncate">{n.body}</p>
                <p className="text-[11px] text-muted mt-1">
                  {n.target_type === 'all' ? 'لكل المستخدمين' : 'مستخدم واحد'} — {new Date(n.sent_at).toLocaleString('ar-EG')}
                  {n.error_message && ` — ${n.error_message}`}
                </p>
              </div>
              <Stamp tone={STATUS_TONE[n.status]}>{STATUS_LABEL[n.status]}</Stamp>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
