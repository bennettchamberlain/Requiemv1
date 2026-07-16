import { Card, Skeleton } from '@ci/shadcn';
import { MapPin } from '@ci/shadcn/icons';

import { usePlaceForecast } from './api';

const HORIZON_HOURS = 4;
const TOP_K = 5;

/** Top-k next-place list from the transition model (no map layer this pass). */
export function NextPlacesPanel() {
  const { forecast, loading } = usePlaceForecast(HORIZON_HOURS, TOP_K);

  const predictions = forecast?.status === 'OK' ? (forecast.predictions ?? []) : [];

  return (
    <Card>
      <Card.Header>
        <Card.Title>Next Places</Card.Title>
        <Card.Description>Where you're likely headed in the next {HORIZON_HOURS} hours.</Card.Description>
      </Card.Header>
      <Card.Content>
        {loading && !forecast ? (
          <div className="space-y-2" data-testid="next-places-skeleton">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : predictions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No place history yet — location patterns appear once positions have been imported.
          </p>
        ) : (
          <ul className="space-y-2">
            {predictions.map((prediction) => (
              <li key={prediction.clusterId} className="flex items-center gap-3 text-sm">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate">
                  {prediction.label ?? `${prediction.lat.toFixed(3)}, ${prediction.lng.toFixed(3)}`}
                </span>
                <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round(prediction.probability * 100)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                  {Math.round(prediction.probability * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card.Content>
    </Card>
  );
}
