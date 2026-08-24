import { usePageTitle } from '@ci/common';
import { cn } from '@ci/shadcn';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useFeatures } from '@/common/feature';
import { PageContent } from '@/components/layout';
import { SELF_SECTIONS } from '@/layouts/Main/SecondaryNavigation/selfSections';
import { PromptsPage } from '@/pages/PromptsPage/PromptsPage';
import { AccountSection } from '@/pages/SettingsPage/sections/AccountSection';
import { StatsPage } from '@/pages/StatsPage/StatsPage';

import { SelfProfileTab } from './SelfProfileTab';

function SelfNav() {
  const { pathname } = useLocation();
  const { isFeatureEnabled } = useFeatures();

  const visible = SELF_SECTIONS.filter((section) => !section.flag || isFeatureEnabled(section.flag));

  return (
    <nav
      aria-label="Self sections"
      className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2 md:gap-2 md:px-6"
    >
      {visible.map((section) => {
        const active = section.match(pathname);

        return (
          <Link
            key={section.to}
            to={section.to}
            className={cn(
              'shrink-0 rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * You, in one place: identity (name, birthday, gender, about — the same
 * Person editor used elsewhere in the graph, pointed at your own entity),
 * what Companion has learned about you, account deletion, life stats, and
 * reflections. Folds together the former `/settings/about-you`,
 * `/settings/account`, `/stats`, and `/memory/reflections`, which now
 * redirect here (see App.tsx).
 */
export function SelfPage() {
  usePageTitle('Self - Companion Intelligence');

  const { isFeatureEnabled } = useFeatures();

  return (
    <div className="flex h-full flex-col">
      <SelfNav />
      <div className="min-h-0 flex-1">
        <Routes>
          <Route index element={<SelfProfileTab />} />
          <Route
            path="account"
            element={
              <PageContent>
                <div className="mx-auto w-full max-w-2xl">
                  <AccountSection />
                </div>
              </PageContent>
            }
          />
          <Route path="stats" element={<StatsPage />} />
          {isFeatureEnabled('insights.page') && <Route path="reflections" element={<PromptsPage />} />}
          <Route path="*" element={<Navigate to="/self" replace />} />
        </Routes>
      </div>
    </div>
  );
}
