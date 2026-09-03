import { Button } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import type { ForecastResponse } from '@/api/useForecastService';
import { ForecastStrip } from '@/components/ForecastStrip';

export interface PredictionBandProps {
  forecast: ForecastResponse | null;
  loading: boolean;
  stalled: boolean;
  showFullForecastLink: boolean;
}

/**
 * Calendar's compact, inspectable view of the day-ahead HBPE histogram.
 *
 * The forecast object crosses this boundary intact. `ForecastStrip` owns the
 * display-only local-clock ordering and exposes every L0/L1 probability on
 * hover; this component only supplies context and honest request states.
 */
export function PredictionBand({ forecast, loading, stalled, showFullForecastLink }: PredictionBandProps) {
  return (
    <section
      aria-labelledby="prediction-band-heading"
      className="rounded-lg border border-border bg-card/40 p-3 md:p-4"
      data-testid="prediction-band"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="prediction-band-heading" className="text-base font-semibold text-foreground">
            Tomorrow&apos;s prediction band
          </h2>
          <p className="text-xs text-muted-foreground">
            96 quarter-hour bins directly from HBPE. Hover a bin to inspect its probabilities.
          </p>
        </div>

        {showFullForecastLink && (
          <Button asChild variant="ghost" size="sm" className="h-8 text-xs">
            <Link to="/forecast">Open full forecast</Link>
          </Button>
        )}
      </div>

      {forecast ? (
        <ForecastStrip
          buckets={forecast.buckets}
          generatedAt={forecast.generatedAt}
          systemStatus={forecast.systemStatus}
          stalled={stalled}
          stillLearning={forecast.stillLearning}
          modelVersion={forecast.modelVersion}
          pipelineEtaSeconds={forecast.pipelineEtaSeconds}
          pipelineDetail={forecast.pipelineDetail}
          className="mt-3"
        />
      ) : (
        <p role={loading ? 'status' : 'alert'} className="mt-3 text-sm text-muted-foreground">
          {loading
            ? 'Loading the prediction band…'
            : "Couldn't reach HBPE for the prediction band. Try again shortly."}
        </p>
      )}
    </section>
  );
}
