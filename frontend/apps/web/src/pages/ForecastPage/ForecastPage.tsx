import { EmptyState, ErrorPage, LoadingPage, usePageTitle } from '@ci/common';
import { CloudSun } from '@ci/shadcn/icons';

import { useForecastService, useWeekAheadService } from '@/api';
import { useFeatures } from '@/common/feature';
import { ForecastStrip } from '@/components/ForecastStrip';
import { PageContent } from '@/components/layout';
import { WeekAhead } from '@/components/WeekAhead';

import { CalibrationPanel, MetricBandsPanel, NextPlacesPanel, NextUpPanel } from './ForecastPanels';
import { useForecastExtras } from './useForecastExtras';

export function ForecastPage() {
  usePageTitle('Forecast - Companion Intelligence');

  const { isFeatureEnabled } = useFeatures();
  const hbpeEnabled = isFeatureEnabled('hbpe');
  const [{ data: forecast, loading, error, stalled }] = useForecastService();
  const extras = useForecastExtras();
  const { week, due } = useWeekAheadService();

  return (
    <>
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
          <div className="flex flex-col gap-6" data-testid="tomorrows-forecast">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Tomorrow&apos;s Forecast</h2>
              <ForecastStrip
                buckets={forecast.buckets}
                generatedAt={forecast.generatedAt}
                systemStatus={forecast.systemStatus}
                stalled={stalled}
              />
            </div>
            <WeekAhead week={week} due={due} />
            <div className="grid gap-4 lg:grid-cols-2">
              <NextUpPanel buckets={forecast.buckets} historyDays={extras.historyDays} />
              <MetricBandsPanel metrics={extras.metrics} />
              <NextPlacesPanel places={extras.places} />
              <CalibrationPanel calibration={extras.calibration} />
            </div>
          </div>
        )}
      </PageContent>
    </>
  );
}
