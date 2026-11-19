import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useToast } from '../UI';
import { isMissingRelation } from '../../lib/clientErrors';
import { activeSubscriptionOf, daysLeft, formatCairoDate } from '../../lib/aiPlans';

// خطة بو الفعّالة للطالب في صفحة ملفه، ورابط لتفعيل/تجديد اشتراك. بيختفي لو جداول الخطط لسه مااتعملتش.
export default function StudentPlanInfo({ userId }) {
  const toast = useToast();
  const [state, setState] = useState({ loading: true, hidden: false, current: null });

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase.from('ai_subscriptions_view').select('*').eq('user_id', userId).order('id', { ascending: false });
      if (!active) return;
      if (error) {
        if (!isMissingRelation(error)) toast('تعذّر تحميل اشتراك الطالب', 'error', error);
        setState({ loading: false, hidden: true, current: null });
        return;
      }
      setState({ loading: false, hidden: false, current: activeSubscriptionOf(data || [], userId) });
    })();
    return () => { active = false; };
  }, [userId, toast]);

  if (state.loading || state.hidden) return null;
  const { current } = state;
  const left = current ? daysLeft(current.ends_at) : null;

  return (
    <div className="bg-surface rounded-xl px-3 py-2.5 mb-4 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-xs text-muted font-semibold mb-0.5">اشتراك بو</p>
        {current ? (
          <p className="text-sm font-semibold">
            خطة "{current.plan_name}" · {current.daily_limit} رسالة/يوم ·{' '}
            {current.ends_at ? `لحد ${formatCairoDate(current.ends_at)} (باقي ${left} يوم)` : 'من غير نهاية'}
          </p>
        ) : (
          <p className="text-sm text-muted">مفيش اشتراك فعّال</p>
        )}
        {current && <p className="text-[11px] text-muted mt-0.5">الاشتراك الفعّال بيكسب على تفعيل بو اليدوي من الأعلى.</p>}
      </div>
      <Link to={`/ai-subscriptions?student=${userId}`} className="btn-ghost !px-3 !py-1.5 text-xs shrink-0">
        {current ? 'تجديد / تغيير' : 'تفعيل اشتراك'}
      </Link>
    </div>
  );
}
