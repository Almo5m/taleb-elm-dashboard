import { useEffect, useState } from 'react';
import { Spinner } from '../UI';
import { fetchSetting } from '../../lib/appSettings';
import ModelStatusCard from './ModelStatusCard';
import AiSubscriptionsCard from './AiSubscriptionsCard';

// تبويب "نظرة عامة": هل بو شغال دلوقتي (حالة الموديلات)، وأرقام الاشتراكات والدخل والتكلفة.
export default function AiOverviewTab() {
  const [chain, setChain] = useState(null); // { model, fallbacks }

  useEffect(() => {
    let active = true;
    (async () => {
      const result = await fetchSetting('ai_assistant');
      if (!active) return;
      const value = result.value || {};
      setChain({
        model: typeof value.model === 'string' ? value.model : '',
        fallbacks: Array.isArray(value.fallback_models) ? value.fallback_models.filter((m) => typeof m === 'string') : [],
      });
    })();
    return () => { active = false; };
  }, []);

  if (!chain) return <Spinner />;

  return (
    <div>
      <ModelStatusCard primary={chain.model} fallbacks={chain.fallbacks} />
      <AiSubscriptionsCard />
    </div>
  );
}
