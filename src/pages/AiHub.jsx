import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/UI';
import AiOverviewTab from '../components/ai/AiOverviewTab';
import AiSettingsPanel from '../components/ai/AiSettingsPanel';
import AiQuestionsTab from '../components/ai/AiQuestionsTab';
import AiPlans from './AiPlans';
import AiSubscriptions from './AiSubscriptions';

// كل حاجة تخص المساعد الذكي (بو) في صفحة واحدة. التبويب في الرابط (?tab=) عشان يتفتح مباشرة ويتشارك.
export const AI_TABS = [
  { key: 'overview', label: 'نظرة عامة' },
  { key: 'questions', label: 'الأسئلة' },
  { key: 'subscriptions', label: 'الاشتراكات' },
  { key: 'plans', label: 'الخطط' },
  { key: 'settings', label: 'الإعدادات' },
];

export default function AiHub() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = AI_TABS.some((t) => t.key === requested) ? requested : 'overview';

  const choose = (key) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    next.delete('student'); // الطالب المختار بيخص تبويب واحد (الاشتراكات أو الأسئلة) بس
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader eyebrow="بو" title="المساعد الذكي" />

      <div role="tablist" aria-label="أقسام المساعد الذكي" className="flex flex-wrap gap-2 mb-6">
        {AI_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`ai-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="ai-tab-panel"
            onClick={() => choose(t.key)}
            className={`px-4 py-2 rounded-full text-sm font-semibold border transition ${
              tab === t.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-surface-line hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="ai-tab-panel" aria-labelledby={`ai-tab-${tab}`}>
        {tab === 'overview' && <AiOverviewTab />}
        {tab === 'questions' && <AiQuestionsTab />}
        {tab === 'subscriptions' && <AiSubscriptions embedded />}
        {tab === 'plans' && <AiPlans embedded />}
        {tab === 'settings' && <AiSettingsPanel />}
      </div>
    </div>
  );
}
