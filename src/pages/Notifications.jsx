import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAppUser } from '../context/AppUser';
import { PageHeader, Spinner, Stamp, EmptyState, useToast, useConfirm } from '../components/UI';
import { logAction } from '../lib/audit';

const STATUS_TONE = { pending: 'gold', sent: 'forest', failed: 'coral' };
const STATUS_LABEL = { pending: 'معلّق', sent: 'اتبعت', failed: 'فشل' };

export default function Notifications() {
  const me = useAppUser();
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

  const sendBroadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastBody.trim()) {
      toast('اكتب العنوان والنص الأول', 'error');
      return;
    }
    const ok = await confirm('متأكد إنك عايز تبعت الإشعار ده لكل المستخدمين؟ الفعل ده مالوش رجوع بعد الإرسال الفعلي.', {
      danger: true,
      confirmLabel: 'إرسال للكل',
    });
    if (!ok) return;

    setSendingBroadcast(true);
    const { error } = await supabase.from('push_notifications_log').insert({
      title: broadcastTitle.trim(),
      body: broadcastBody.trim(),
      target_type: 'all',
      status: 'pending',
      sent_by_admin_id: me?.id,
      sent_by_admin_name: me?.name || 'أدمن',
    });
    setSendingBroadcast(false);

    if (error) {
      toast('حصل خطأ، حاول تاني', 'error');
      return;
    }
    logAction({
      adminId: me?.id,
      adminName: me?.name || 'أدمن',
      action: 'إرسال إشعار عام',
      targetType: 'notification',
      targetId: null,
      details: { title: broadcastTitle.trim() },
    });
    toast('اتسجّل الإشعار — هيتبعت فعليًا بعد ما يتكامل التطبيق مع Firebase', 'success');
    setBroadcastTitle('');
    setBroadcastBody('');
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
    const { error } = await supabase.from('push_notifications_log').insert({
      title: singleTitle.trim(),
      body: singleBody.trim(),
      target_type: 'single_user',
      target_user_id: selectedUser.id,
      status: 'pending',
      sent_by_admin_id: me?.id,
      sent_by_admin_name: me?.name || 'أدمن',
    });
    setSendingSingle(false);

    if (error) {
      toast('حصل خطأ، حاول تاني', 'error');
      return;
    }
    logAction({
      adminId: me?.id,
      adminName: me?.name || 'أدمن',
      action: 'إرسال إشعار لمستخدم واحد',
      targetType: 'notification',
      targetId: selectedUser.id,
      details: { title: singleTitle.trim(), target: selectedUser.name },
    });
    toast('اتسجّل الإشعار — هيتبعت فعليًا بعد ما يتكامل التطبيق مع Firebase', 'success');
    setSingleTitle('');
    setSingleBody('');
    setSelectedUser(null);
    setUserQuery('');
    loadLog();
  };

  return (
    <div>
      <PageHeader eyebrow="تواصل" title="الإشعارات" />
      <div className="card p-4 mb-6 bg-gold/10 border border-gold/30">
        <p className="text-sm">
          ⚠️ الإرسال الفعلي لسه مش شغال — التطبيق محتاج يتكامل مع Firebase Cloud Messaging الأول.
          دلوقتي أي إشعار بتبعته بيتسجّل بحالة <b>"معلّق"</b> وهيتبعت فعليًا لما التكامل يخلص.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-5 mb-6">
        <div className="card p-6">
          <p className="font-messiri font-bold mb-1">إشعار عام لكل المستخدمين</p>
          <p className="text-xs text-muted mb-4">هيوصل لكل الطلاب المسجّلين</p>
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
            {sendingBroadcast ? 'جارِ التسجيل...' : 'إرسال لكل المستخدمين'}
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
            {sendingSingle ? 'جارِ التسجيل...' : 'إرسال لهذا المستخدم بس'}
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
