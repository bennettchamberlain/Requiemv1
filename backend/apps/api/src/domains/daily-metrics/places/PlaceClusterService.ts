import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { PlaceClusterEntity } from '../entities/PlaceClusterEntity';

import {
  CLUSTERS_FOR_USER_SQL,
  parseClusterRow,
  parsePositionRow,
  POSITION_PAGE_SQL,
  REVERSE_GEOCODE_LABEL_SQL,
  SET_CLUSTER_LABEL_SQL,
  toEwktPoint,
  UPSERT_CLUSTER_SQL,
} from './placeSql';
import {
  clusterStays,
  DEFAULT_MAX_GAP_MS,
  DEFAULT_STAY_RADIUS_M,
  detectStays,
  type PositionFix,
  type StayPoint,
} from './stayPoints';
import type { ClusterVisit } from './transitionMath';
import type { BuildClustersResult, PlaceClusterSnapshot } from './types';

/** Fixes with a reported accuracy worse than this smear stays; drop them. */
const MAX_ACCURACY_M = 100;
const POSITION_PAGE_SIZE = 10_000;
const DEFAULT_WINDOW_DAYS = 90;
const MS_PER_DAY = 86_400_000;

export interface BuildClustersOptions {
  /** How many days of ci.position to scan, ending at endTime. */
  windowDays?: number;
  /** Inclusive end of the scan window (defaults to now). */
  endTime?: Date;
}

/**
 * Mines stable place clusters out of raw GPS fixes: stream ci.position ->
 * sessionized stay-point detection (>= 15 min within ~150 m) -> greedy
 * centroid clustering (merge within 150 m) -> idempotent upsert into
 * ci_derived.place_clusters. Labels come read-only from already-cached
 * reverse-geocode rows in ci.geocode_cache; no external calls are ever made.
 *
 * Recompute-from-window semantics: existing clusters seed the run as identity
 * anchors (ids and centroids stay stable), while visit_count and the seen
 * range are recomputed from the scanned window, so re-running the same window
 * is idempotent (counts never double). With the default 90-day window,
 * visit_count therefore reads as "stays in the last ~90 days" — deliberately
 * recency-relevant for the transition model's global prior. Clusters that get
 * no visits in the window are left untouched.
 */
@Injectable()
export class PlaceClusterService {
  constructor(
    @InjectRepository(PlaceClusterEntity)
    private readonly clusterRepository: Repository<PlaceClusterEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaceClusterService.name);
  }

  /** All clusters of the user, most recently visited first. */
  async getClusters(context: UserServiceContext): Promise<PlaceClusterSnapshot[]> {
    const rows = (await this.clusterRepository.query(CLUSTERS_FOR_USER_SQL, [context.userId])) as Array<
      Record<string, unknown>
    >;

    return rows.map(parseClusterRow);
  }

  /**
   * Stream one time window of usable GPS fixes (keyset-paged on the position
   * hypertable's time PK, accuracy-filtered), oldest first.
   */
  async getPositionWindow(context: UserServiceContext, from: Date, to: Date): Promise<PositionFix[]> {
    const fixes: PositionFix[] = [];
    let cursor = from;

    for (;;) {
      const rows = (await this.clusterRepository.query(POSITION_PAGE_SQL, [
        context.userId,
        cursor.toISOString(),
        to.toISOString(),
        MAX_ACCURACY_M,
        POSITION_PAGE_SIZE,
      ])) as Array<Record<string, unknown>>;

      const page = rows.map(parsePositionRow);
      fixes.push(...page);

      if (page.length < POSITION_PAGE_SIZE) {
        return fixes;
      }

      cursor = page[page.length - 1].time;
    }
  }

  /** Detect stays over a window of fixes, splitting sessions on capture gaps. */
  detectWindowStays(fixes: PositionFix[]): StayPoint[] {
    return detectStays(fixes, { maxGapMs: DEFAULT_MAX_GAP_MS });
  }

  /**
   * The full build: scan the window, detect stays, cluster them, upsert, and
   * label. Returns the touched clusters plus the chronological cluster-visit
   * sequence the transition model consumes.
   */
  async buildClusters(
    context: UserServiceContext,
    options: BuildClustersOptions = {},
  ): Promise<BuildClustersResult> {
    const end = options.endTime ?? new Date();
    const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
    const start = new Date(end.getTime() - windowDays * MS_PER_DAY);

    const existing = await this.getClusters(context);
    const fixes = await this.getPositionWindow(context, start, end);
    const stays = this.detectWindowStays(fixes);

    const { clusters, assignments } = clusterStays(
      stays,
      existing.map((cluster) => ({
        id: cluster.id,
        lat: cluster.lat,
        lng: cluster.lng,
        radiusM: cluster.radiusM,
      })),
      DEFAULT_STAY_RADIUS_M,
    );

    // Materialize ids (new clusters get theirs app-side so the visit sequence
    // can reference them without a re-read) and upsert the touched ones.
    const existingById = new Map(existing.map((cluster) => [cluster.id, cluster]));
    const idByIndex: string[] = clusters.map((cluster) => cluster.id ?? randomUUID());
    const touched: PlaceClusterSnapshot[] = [];

    for (let index = 0; index < clusters.length; index++) {
      const cluster = clusters[index];
      if (cluster.visitCount === 0) {
        continue;
      }

      const id = idByIndex[index];

      await this.clusterRepository.query(UPSERT_CLUSTER_SQL, [
        id,
        context.userId,
        toEwktPoint(cluster.lat, cluster.lng),
        cluster.radiusM,
        cluster.visitCount,
        cluster.firstSeen,
        cluster.lastSeen,
      ]);

      const label = await this.ensureLabel(context, id, cluster, existingById.get(id)?.label ?? null);

      touched.push({
        id,
        lat: cluster.lat,
        lng: cluster.lng,
        radiusM: cluster.radiusM,
        label,
        visitCount: cluster.visitCount,
        firstSeen: cluster.firstSeen,
        lastSeen: cluster.lastSeen,
      });
    }

    const visits: ClusterVisit[] = assignments
      .map((assignment) => ({
        clusterId: idByIndex[assignment.clusterIndex],
        start: stays[assignment.stayIndex].start,
        end: stays[assignment.stayIndex].end,
      }))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    this.logger.log('Built place clusters', {
      userId: context.userId,
      windowDays,
      fixes: fixes.length,
      stays: stays.length,
      clusters: touched.length,
      visits: visits.length,
    });

    return { clusters: touched, visits };
  }

  /**
   * Keep an existing label, otherwise try the read-only reverse-geocode cache
   * lookup and persist a hit. Returns whatever label the cluster ends up with.
   */
  private async ensureLabel(
    context: UserServiceContext,
    id: string,
    cluster: { lat: number; lng: number; radiusM: number },
    existingLabel: string | null,
  ): Promise<string | null> {
    if (existingLabel !== null) {
      return existingLabel;
    }

    const rows = (await this.clusterRepository.query(REVERSE_GEOCODE_LABEL_SQL, [
      toEwktPoint(cluster.lat, cluster.lng),
      Math.max(cluster.radiusM, DEFAULT_STAY_RADIUS_M),
    ])) as Array<Record<string, unknown>>;

    const label = rows[0]?.label;
    if (label === null || label === undefined) {
      return null;
    }

    await this.clusterRepository.query(SET_CLUSTER_LABEL_SQL, [id, context.userId, String(label)]);

    return String(label);
  }
}
