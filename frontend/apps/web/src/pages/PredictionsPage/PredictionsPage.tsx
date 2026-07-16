import { useMemo } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import { useForecastService } from '@/api';
import { useFeatures } from '@/common/feature';
import { PageContent } from '@/components/layout';
import { pastDateKeys } from '@/components/PredictionHeatmap';

import { useForecastWeekHistory, type HistoryDates } from './api';
import { CalibrationPanel } from './CalibrationPanel';
import { MetricForecastPanel } from './MetricForecastPanel';
import { NextPlacesPanel } from './NextPlacesPanel';
import type { HistoryDay } from './nextUpModel';
import { NextUpPanel } from './NextUpPanel';
import { PanelBoundary } from './PanelBoundary';
import { WeekHeatmapPanel } from './WeekHeatmapPanel';

const PAST_DAYS = 5;

function Breadcrumbs() {
  return (
    <Portal.Slot id="breadcrumbs">
      <Breadcrumb>
        <Breadcrumb.List>
          <Breadcrumb.Item className="hidden md:block">
            <Breadcrumb.Link asChild>
              <Link to="/feed">Companion</Link>
            </Breadcrumb.Link>
          </Breadcrumb.Item>
          <Breadcrumb.Separator className="hidden md:block" />
          <Breadcrumb.Item>
            <Breadcrumb.Page>Predictions</Breadcrumb.Page>
          </Breadcrumb.Item>
        </Breadcrumb.List>
      </Breadcrumb>
    </Portal.Slot>
  );
}

function PredictionsDashboard() {
  const dates = useMemo<HistoryDates>(() => {
    const [d0, d1, d2, d3, d4] = pastDateKeys(PAST_DAYS);

    return { d0, d1, d2, d3, d4 };
  }, []);

  const [{ data: forecast, loading: forecastLoading, stalled: forecastStalled }] = useForecastService();
  const { data: historyData, loading: historyLoading } = useForecastWeekHistory(dates);

  const historyDays = useMemo<HistoryDay[]>(() => {
    if (!historyData) {
      return [];
    }

    const days = [historyData.d0, historyData.d1, historyData.d2, historyData.d3, historyData.d4];

    return days.flatMap((day, index) => {
      const date = Object.values(dates)[index];
      const buckets = (day?.buckets ?? []).map((bucket) => ({
        bucketIndex: bucket.bucketIndex,
        startTime: bucket.startTime,
        predictedL0: bucket.predictedL0,
        actualL0: bucket.actualL0 ?? null,
      }));

      return [{ date, buckets }];
    });
  }, [dates, historyData]);

  return (
    <PageContent>
      <h2 className="text-2xl font-bold text-foreground">Predictions</h2>

      <PanelBoundary title="Week at a Glance">
        <WeekHeatmapPanel
          historyDays={historyDays}
          historyLoading={historyLoading}
          forecast={forecast}
          forecastStalled={forecastStalled}
        />
      </PanelBoundary>

      <div className="grid gap-6 lg:grid-cols-2">
        <PanelBoundary title="Next Up">
          <NextUpPanel forecast={forecast} forecastLoading={forecastLoading} historyDays={historyDays} />
        </PanelBoundary>

        <PanelBoundary title="Calibration">
          <CalibrationPanel />
        </PanelBoundary>

        <PanelBoundary title="Metric Forecasts">
          <MetricForecastPanel />
        </PanelBoundary>

        <PanelBoundary title="Next Places">
          <NextPlacesPanel />
        </PanelBoundary>
      </div>
    </PageContent>
  );
}

export function PredictionsPage() {
  usePageTitle('Predictions - Companion Intelligence');

  const { isFeatureEnabled } = useFeatures();

  if (!isFeatureEnabled('hbpe')) {
    return (
      <>
        <Breadcrumbs />
        <PageContent>
          <div className="flex min-h-[40vh] items-center justify-center py-10">
            <p className="max-w-md text-center text-lg font-medium text-muted-foreground opacity-70">
              Predictions are off — enable the "hbpe" feature to see your behavioral forecasts here.
            </p>
          </div>
        </PageContent>
      </>
    );
  }

  return (
    <>
      <Breadcrumbs />
      <PredictionsDashboard />
    </>
  );
}
