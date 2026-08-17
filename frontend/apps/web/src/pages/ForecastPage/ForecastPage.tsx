import { EmptyState, ErrorPage, LoadingPage, Portal, usePageTitle } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';
import { CloudSun } from '@ci/shadcn/icons';

import { useForecastService } from '@/api';
import { useFeatures } from '@/common/feature';
import { ForecastStrip } from '@/components/ForecastStrip';
import { PageContent } from '@/components/layout';

export function ForecastPage() {
  usePageTitle('Forecast - Companion Intelligence');

  const { isFeatureEnabled } = useFeatures();
  const hbpeEnabled = isFeatureEnabled('hbpe');
  const [{ data: forecast, loading, error, stalled }] = useForecastService();

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item>
              <Breadcrumb.Page>Forecast</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        {!hbpeEnabled ? (
          <div className="relative min-h-60 flex-1">
            <EmptyState icon={<CloudSun size={48} />} message="Forecast is off for this workspace." />
          </div>
        ) : loading && !forecast ? (
          <LoadingPage />
        ) : error && !forecast ? (
          <ErrorPage error={error} />
        ) : !forecast ? (
          <div className="relative min-h-60 flex-1">
            <EmptyState
              icon={<CloudSun size={48} />}
              message="No forecast yet. Use Add → Predict to start the model."
            />
          </div>
        ) : (
          <div className="contents" data-testid="tomorrows-forecast">
            <h2 className="text-2xl font-bold text-foreground">Tomorrow's Forecast</h2>
            <ForecastStrip
              buckets={forecast.buckets}
              generatedAt={forecast.generatedAt}
              systemStatus={forecast.systemStatus}
              stalled={stalled}
            />
          </div>
        )}
      </PageContent>
    </>
  );
}
