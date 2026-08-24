import { Navigate, Route, Routes } from 'react-router-dom';

import { useFeatures } from '@/common/feature';
import { PromptsPage } from '@/pages/PromptsPage/PromptsPage';
import { StatsPage } from '@/pages/StatsPage/StatsPage';

import { SelfProfileTab } from './SelfProfileTab';

/**
 * You, in one place: identity (name, birthday, gender, about — the same
 * Person editor used elsewhere in the graph, pointed at your own entity),
 * what Companion has learned about you, account deletion, life stats, and
 * reflections. Folds together the former `/settings/about-you`,
 * `/settings/account`, `/stats`, and `/memory/reflections`, which now
 * redirect here (see App.tsx). Navigated entirely from the Power Rail's Self
 * submenu — no in-page tab bar of its own.
 */
export function SelfPage() {
  const { isFeatureEnabled } = useFeatures();

  return (
    <div className="h-full min-h-0">
      <Routes>
        <Route index element={<SelfProfileTab />} />
        <Route path="stats" element={<StatsPage />} />
        {isFeatureEnabled('insights.page') && <Route path="reflections" element={<PromptsPage />} />}
        <Route path="*" element={<Navigate to="/self" replace />} />
      </Routes>
    </div>
  );
}
