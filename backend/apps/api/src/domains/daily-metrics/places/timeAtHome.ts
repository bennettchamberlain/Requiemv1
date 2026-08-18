import { DEFAULT_STAY_RADIUS_M, detectStays, haversineMeters, type PositionFix, type StayPoint } from './stayPoints';

export interface HomePoint {
  lat: number;
  lng: number;
  radiusM?: number;
}

export interface TimeAtHomeResult {
  /** Minutes of stay-points whose centroid is within home radius; null when unlabeled or no stays. */
  minutes: number | null;
  /** Fraction of located-stay minutes that matched home; 0 when unlabeled or no stays. */
  coverage: number;
}

function stayMinutes(stay: StayPoint): number {
  return Math.max(0, (stay.end.getTime() - stay.start.getTime()) / 60_000);
}

/**
 * Sum stay-point minutes whose centroid is within the home point's radius
 * (cluster radius when known, otherwise the stay-detection radius).
 */
export function timeAtHomeFromFixes(fixes: PositionFix[], home: HomePoint | null): TimeAtHomeResult {
  if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lng)) {
    return { minutes: null, coverage: 0 };
  }

  const stays = detectStays(fixes);
  if (stays.length === 0) {
    return { minutes: null, coverage: 0 };
  }

  const radiusM = home.radiusM && home.radiusM > 0 ? home.radiusM : DEFAULT_STAY_RADIUS_M;
  let matched = 0;
  let total = 0;

  for (const stay of stays) {
    const minutes = stayMinutes(stay);
    total += minutes;
    if (haversineMeters(stay.lat, stay.lng, home.lat, home.lng) <= radiusM) {
      matched += minutes;
    }
  }

  if (total <= 0) {
    return { minutes: null, coverage: 0 };
  }

  return {
    minutes: Math.round(matched * 10) / 10,
    coverage: Math.max(0, Math.min(1, matched / total)),
  };
}
