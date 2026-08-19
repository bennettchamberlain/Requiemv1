import {
  clusterStays,
  detectStays,
  haversineMeters,
  nearestCluster,
  type PositionFix,
  type StayPoint,
} from './stayPoints';

const MINUTE = 60_000;
const T0 = new Date('2026-07-06T09:00:00Z').getTime();

/** ~1e-5 deg of latitude is ~1.1 m — jitter well inside the stay radius. */
function fix(minutes: number, lat: number, lng: number): PositionFix {
  return { time: new Date(T0 + minutes * MINUTE), lat, lng };
}

/** `count` fixes at ~(lat, lng) with meter-scale jitter, every 2 minutes. */
function dwell(startMinute: number, count: number, lat: number, lng: number): PositionFix[] {
  return Array.from({ length: count }, (_, i) => fix(startMinute + i * 2, lat + i * 1e-5, lng));
}

const HOME = { lat: 40.0, lng: -73.0 };
// ~2.2 km north of home — clearly a different place.
const OFFICE = { lat: 40.02, lng: -73.0 };

describe('haversineMeters', () => {
  it('matches known distances', () => {
    expect(haversineMeters(40, -73, 40, -73)).toBe(0);
    // 0.02 deg of latitude is ~2224 m.
    expect(haversineMeters(HOME.lat, HOME.lng, OFFICE.lat, OFFICE.lng)).toBeCloseTo(2224, -1);
  });
});

describe('detectStays', () => {
  it('finds two stays and ignores the transit between them (two visits + transit fixture)', () => {
    const atHome = dwell(0, 11, HOME.lat, HOME.lng); // 20 min at home
    // Transit: 3 fixes marching north ~550 m apart — never 15 min in one spot.
    const transit = [22, 24, 26].map((minute, i) => fix(minute, HOME.lat + 0.005 * (i + 1), HOME.lng));
    const atOffice = dwell(30, 16, OFFICE.lat, OFFICE.lng); // 30 min at office

    const stays = detectStays([...atHome, ...transit, ...atOffice]);

    expect(stays).toHaveLength(2);
    expect(stays[0].lat).toBeCloseTo(HOME.lat, 3);
    expect(stays[0].lng).toBeCloseTo(HOME.lng, 3);
    expect(stays[0].start).toEqual(new Date(T0));
    expect(stays[0].end).toEqual(new Date(T0 + 20 * MINUTE));
    expect(stays[1].lat).toBeCloseTo(OFFICE.lat, 3);
    expect(stays[1].fixCount).toBe(16);
  });

  it('does not report a stay for a dwell shorter than 15 minutes', () => {
    const stays = detectStays(dwell(0, 6, HOME.lat, HOME.lng)); // 10 min

    expect(stays).toHaveLength(0);
  });

  it('never bridges a capture gap: same spot before and after a 3-day hole is two stays', () => {
    const before = dwell(0, 11, HOME.lat, HOME.lng);
    const after = dwell(3 * 24 * 60, 11, HOME.lat, HOME.lng);

    const stays = detectStays([...before, ...after]);

    expect(stays).toHaveLength(2);
  });

  it('sorts unordered input before detecting', () => {
    const shuffled = [...dwell(0, 11, HOME.lat, HOME.lng)].reverse();

    expect(detectStays(shuffled)).toHaveLength(1);
  });
});

function stayAt(lat: number, lng: number, startMinute: number): StayPoint {
  return {
    lat,
    lng,
    start: new Date(T0 + startMinute * MINUTE),
    end: new Date(T0 + (startMinute + 20) * MINUTE),
    fixCount: 10,
  };
}

describe('clusterStays', () => {
  it('merges stays within 150 m into one cluster and separates distant ones', () => {
    const stays = [
      stayAt(HOME.lat, HOME.lng, 0),
      stayAt(HOME.lat + 0.0005, HOME.lng, 60), // ~55 m away — same place
      stayAt(OFFICE.lat, OFFICE.lng, 120),
    ];

    const { clusters, assignments } = clusterStays(stays, []);

    expect(clusters).toHaveLength(2);
    expect(clusters[0].visitCount).toBe(2);
    expect(clusters[0].lat).toBeCloseTo(HOME.lat + 0.00025, 5); // running mean
    expect(clusters[1].visitCount).toBe(1);
    expect(assignments).toEqual([
      { stayIndex: 0, clusterIndex: 0 },
      { stayIndex: 1, clusterIndex: 0 },
      { stayIndex: 2, clusterIndex: 1 },
    ]);
  });

  it('keeps seeded clusters as fixed identity anchors and recomputes counts from the run', () => {
    const seed = { id: 'cluster-home', lat: HOME.lat, lng: HOME.lng, radiusM: 150 };
    const stays = [stayAt(HOME.lat + 0.0005, HOME.lng, 0)];

    const { clusters } = clusterStays(stays, [seed]);

    expect(clusters[0].id).toBe('cluster-home');
    expect(clusters[0].lat).toBe(HOME.lat); // seed centroid never drifts
    expect(clusters[0].visitCount).toBe(1); // window count, not accumulated
    expect(clusters[0].firstSeen).toEqual(stays[0].start);
    expect(clusters[0].lastSeen).toEqual(stays[0].end);
  });

  it('is idempotent: re-clustering the same stays against the produced seeds repeats the counts', () => {
    const stays = [stayAt(HOME.lat, HOME.lng, 0), stayAt(HOME.lat, HOME.lng, 60)];
    const first = clusterStays(stays, []);
    const seeds = first.clusters.map((cluster, i) => ({
      id: `id-${i}`,
      lat: cluster.lat,
      lng: cluster.lng,
      radiusM: cluster.radiusM,
    }));

    const second = clusterStays(stays, seeds);

    expect(second.clusters).toHaveLength(first.clusters.length);
    expect(second.clusters[0].visitCount).toBe(first.clusters[0].visitCount);
  });
});

describe('nearestCluster', () => {
  const clusters = [
    { id: 'home', lat: HOME.lat, lng: HOME.lng, radiusM: 150 },
    { id: 'office', lat: OFFICE.lat, lng: OFFICE.lng, radiusM: 150 },
  ];

  it('snaps to the closest cluster within its radius', () => {
    expect(nearestCluster(HOME.lat + 0.0005, HOME.lng, clusters)?.id).toBe('home');
  });

  it('returns null when nothing is close enough', () => {
    expect(nearestCluster(41.0, -73.0, clusters)).toBeNull();
  });
});
