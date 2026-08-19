/**
 * Pure stay-point detection and greedy clustering over GPS fixes.
 *
 * Everything here is deterministic and database-free (the DailyMetrics
 * "compute in pure functions, persist in the service" pattern): the service
 * streams ci.position rows in, and these functions turn them into stays and
 * clusters that are unit-testable with synthetic fixtures.
 */

/** One usable GPS fix (location non-null, accuracy already filtered). */
export interface PositionFix {
  time: Date;
  lat: number;
  lng: number;
}

/** A detected stay: the user dwelt >= minDwell within radiusM of one spot. */
export interface StayPoint {
  /** Arithmetic-mean centroid of the fixes in the stay. */
  lat: number;
  lng: number;
  start: Date;
  end: Date;
  fixCount: number;
}

export interface StayDetectionOptions {
  /** Max distance from the stay's anchor fix, meters. */
  radiusM?: number;
  /** Minimum dwell time to count as a stay, ms. */
  minDwellMs?: number;
  /** A gap between consecutive fixes larger than this splits the session. */
  maxGapMs?: number;
}

export const DEFAULT_STAY_RADIUS_M = 150;
export const DEFAULT_MIN_DWELL_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_GAP_MS = 60 * 60 * 1000;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two (lat, lng) pairs in meters. */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * sinLng * sinLng;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Split a chronological fix stream into sessions on gaps > maxGapMs. */
function sessionize(fixes: PositionFix[], maxGapMs: number): PositionFix[][] {
  const sessions: PositionFix[][] = [];
  let current: PositionFix[] = [];

  for (const fix of fixes) {
    const previous = current[current.length - 1];
    if (previous && fix.time.getTime() - previous.time.getTime() > maxGapMs) {
      sessions.push(current);
      current = [];
    }

    current.push(fix);
  }

  if (current.length > 0) {
    sessions.push(current);
  }

  return sessions;
}

function centroidOf(fixes: PositionFix[]): StayPoint {
  let latSum = 0;
  let lngSum = 0;

  for (const fix of fixes) {
    latSum += fix.lat;
    lngSum += fix.lng;
  }

  return {
    lat: latSum / fixes.length,
    lng: lngSum / fixes.length,
    start: fixes[0].time,
    end: fixes[fixes.length - 1].time,
    fixCount: fixes.length,
  };
}

/**
 * Stay-point detection (Li et al. anchor sweep): walk an anchor fix i forward;
 * extend j while every fix stays within radiusM of the anchor; if the covered
 * span is >= minDwellMs the window is a stay (centroid of its fixes) and the
 * sweep resumes at j, otherwise the anchor advances by one. Fixes are
 * sessionized first so a stay never bridges a capture gap — 20 minutes at home,
 * a 3-day data hole, then 20 minutes at home again is two stays, not one.
 */
export function detectStays(fixes: PositionFix[], options: StayDetectionOptions = {}): StayPoint[] {
  const radiusM = options.radiusM ?? DEFAULT_STAY_RADIUS_M;
  const minDwellMs = options.minDwellMs ?? DEFAULT_MIN_DWELL_MS;
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;

  const ordered = [...fixes].sort((a, b) => a.time.getTime() - b.time.getTime());
  const stays: StayPoint[] = [];

  for (const session of sessionize(ordered, maxGapMs)) {
    let i = 0;

    while (i < session.length) {
      let j = i + 1;

      while (
        j < session.length &&
        haversineMeters(session[i].lat, session[i].lng, session[j].lat, session[j].lng) <= radiusM
      ) {
        j += 1;
      }

      const dwellMs = session[j - 1].time.getTime() - session[i].time.getTime();
      if (dwellMs >= minDwellMs) {
        stays.push(centroidOf(session.slice(i, j)));
        i = j;
      } else {
        i += 1;
      }
    }
  }

  return stays;
}

/** A cluster being accumulated by {@link clusterStays}. */
export interface ClusterAccumulator {
  /** Existing DB cluster id when seeded; null for a cluster new in this run. */
  id: string | null;
  lat: number;
  lng: number;
  radiusM: number;
  /** Stays assigned in THIS run (recompute-from-window semantics). */
  visitCount: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
}

export interface ClusterSeed {
  id: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export interface StayAssignment {
  stayIndex: number;
  clusterIndex: number;
}

/**
 * Greedy clustering of stay centroids: each stay (chronological) joins the
 * nearest cluster within mergeRadiusM or founds a new one. Seeds are existing
 * DB clusters used as identity anchors — their centroid stays FIXED (so
 * re-runs keep matching the same rows and ids never drift), while new clusters
 * re-center on the running mean of their member stays. Counts and seen-ranges
 * are recomputed from the supplied stays only, so running the same window
 * twice yields identical clusters (idempotent upsert upstream).
 */
export function clusterStays(
  stays: StayPoint[],
  seeds: ClusterSeed[],
  mergeRadiusM = DEFAULT_STAY_RADIUS_M,
): { clusters: ClusterAccumulator[]; assignments: StayAssignment[] } {
  const clusters: ClusterAccumulator[] = seeds.map((seed) => ({
    id: seed.id,
    lat: seed.lat,
    lng: seed.lng,
    radiusM: Math.max(seed.radiusM, 0),
    visitCount: 0,
    firstSeen: null,
    lastSeen: null,
  }));
  const assignments: StayAssignment[] = [];

  stays.forEach((stay, stayIndex) => {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    clusters.forEach((cluster, clusterIndex) => {
      const distance = haversineMeters(stay.lat, stay.lng, cluster.lat, cluster.lng);
      if (distance <= mergeRadiusM && distance < bestDistance) {
        best = clusterIndex;
        bestDistance = distance;
      }
    });

    if (best === -1) {
      clusters.push({
        id: null,
        lat: stay.lat,
        lng: stay.lng,
        radiusM: mergeRadiusM,
        visitCount: 1,
        firstSeen: stay.start,
        lastSeen: stay.end,
      });
      assignments.push({ stayIndex, clusterIndex: clusters.length - 1 });

      return;
    }

    const cluster = clusters[best];
    if (cluster.id === null) {
      // New-this-run cluster: re-center on the running mean of member stays.
      cluster.lat = (cluster.lat * cluster.visitCount + stay.lat) / (cluster.visitCount + 1);
      cluster.lng = (cluster.lng * cluster.visitCount + stay.lng) / (cluster.visitCount + 1);
    }

    cluster.radiusM = Math.max(cluster.radiusM, bestDistance, mergeRadiusM);
    cluster.visitCount += 1;
    cluster.firstSeen =
      cluster.firstSeen === null || stay.start < cluster.firstSeen ? stay.start : cluster.firstSeen;
    cluster.lastSeen = cluster.lastSeen === null || stay.end > cluster.lastSeen ? stay.end : cluster.lastSeen;
    assignments.push({ stayIndex, clusterIndex: best });
  });

  return { clusters, assignments };
}

/**
 * Snap a point to the nearest cluster whose effective radius (floored at
 * defaultRadiusM) contains it; null when no cluster is close enough.
 */
export function nearestCluster<T extends { lat: number; lng: number; radiusM: number }>(
  lat: number,
  lng: number,
  clusters: T[],
  defaultRadiusM = DEFAULT_STAY_RADIUS_M,
): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const cluster of clusters) {
    const distance = haversineMeters(lat, lng, cluster.lat, cluster.lng);
    if (distance <= Math.max(cluster.radiusM, defaultRadiusM) && distance < bestDistance) {
      best = cluster;
      bestDistance = distance;
    }
  }

  return best;
}
