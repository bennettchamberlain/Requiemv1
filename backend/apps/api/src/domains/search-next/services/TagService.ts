import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { type ServiceContext, SYSTEM_USER, type UserServiceContext } from '@ci/common/context';

import { type EntityTag, EntityTagEntity } from '../entities/EntityTagEntity';
import { type Tag, TagEntity, TimestampedTag } from '../entities/TagEntity';
import type { CreateTagDto, EntityIdentifier, TaggableEntity, TagEntitiesDto, UpdateTagDto } from '../types';

type FindOpts = {
  includeEntities?: boolean;
};

export type UpdateTagResult = {
  /** The surviving tag. On a merge this is the pre-existing target, not the edited one. */
  tag: Tag;
  /** The new label collided with another of the user's tags, so the two were collapsed into one. */
  merged: boolean;
  /** Assignments re-pointed onto the surviving tag. Zero unless `merged`. */
  movedAssignments: number;
  /** The label before the edit, so callers can re-point label-keyed rows (saved searches). */
  previousLabel: string;
};

export type RemoveTagResult = {
  label: string;
  /** `entity_tag` rows dropped with the tag — the number of memories that lose it. */
  removedAssignments: number;
};

@Injectable()
export class TagService {
  constructor(
    @InjectRepository(TagEntity)
    private readonly tagRepository: Repository<TagEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(context: ServiceContext, data: CreateTagDto): Promise<Tag> {
    const id = data.id ?? uuid7();

    const label = this.validateLabel(data.label);

    if (context.userId === SYSTEM_USER && data.forUserId == null) {
      throw new Error('System user cannot create a tag without a forUserId specified');
    }

    if (context.userId !== SYSTEM_USER && data.forUserId != null && data.forUserId !== context.userId) {
      throw new Error('Cannot create a tag for another user');
    }

    const userId = context.userId === SYSTEM_USER ? data.forUserId : context.userId;

    const instance = this.tagRepository.create({
      id,
      label,
      description: data.description,
      userId,
    });

    const entity = await this.tagRepository.save(instance);

    return TagEntity.toEgressType(entity);
  }

  async findAll(context: ServiceContext): Promise<Tag[]> {
    const entities = await this.tagRepository.find({
      where: {
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    return entities.map((entity) => TagEntity.toEgressType(entity));
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<(Tag | null)[]> {
    const entities = await this.tagRepository.find({
      where: {
        id: In(ids),
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
    });

    const map = new Map(entities.map((entity) => [entity.id, TagEntity.toEgressType(entity)]));

    return ids.map((id) => map.get(id) ?? null);
  }

  async findById(context: ServiceContext, id: string, opts: FindOpts = {}): Promise<Tag | null> {
    const { includeEntities = false } = opts;

    const entity = await this.tagRepository.findOne({
      where: {
        id,
        ...(context.userId !== SYSTEM_USER && {
          userId: context.userId,
        }),
      },
      relations: includeEntities ? ['entities'] : [],
    });

    return entity ? TagEntity.toEgressType(entity) : null;
  }

  async findByLabel(context: UserServiceContext, label: string, opts: FindOpts = {}): Promise<Tag | null> {
    const { includeEntities = false } = opts;

    // Tags are unique by (label, userId). Searching for label as the system
    // user would change the contract of this method, so we're enforcing that a
    // non-system user context is used.

    const entity = await this.tagRepository.findOne({
      where: {
        label,
        userId: context.userId,
      },
      relations: includeEntities ? ['entities'] : [],
    });

    return entity ? TagEntity.toEgressType(entity) : null;
  }

  /**
   * Substring-match the user's tag labels for search suggestions. Prefix
   * matches rank ahead of mid-label matches, ties break alphabetically. Like
   * findByLabel, this is a per-user vocabulary lookup so a non-system context
   * is required.
   */
  async searchByLabel(context: UserServiceContext, query: string, limit = 5): Promise<Tag[]> {
    const trimmed = query.trim().toLowerCase();

    if (trimmed.length === 0) {
      return [];
    }

    // Escape LIKE metacharacters so a literal % or _ in the query can't widen the match.
    const escaped = trimmed.replace(/[\\%_]/g, '\\$&');

    const entities = await this.tagRepository
      .createQueryBuilder('t')
      .where('t.user_id = :userId', { userId: context.userId })
      .andWhere('t.deleted_at IS NULL')
      .andWhere('t.label ILIKE :contains', { contains: `%${escaped}%` })
      .orderBy('t.label ILIKE :prefix', 'DESC')
      .addOrderBy('t.label', 'ASC')
      .setParameter('prefix', `${escaped}%`)
      .limit(limit)
      .getMany();

    return entities.map((entity) => TagEntity.toEgressType(entity));
  }

  /**
   * Rename a tag and/or re-describe it.
   *
   * Labels are unique per user (`tags_label_user_key`), so renaming onto a
   * label the user already owns cannot be a plain UPDATE — it would come back
   * as a raw unique violation. Instead the two tags are **merged**: the edited
   * tag's assignments are re-pointed onto the tag that already carries the
   * target label, duplicates are dropped, and the now-empty source row is
   * deleted. The surviving tag is the pre-existing target (its id and
   * description are kept), which is what "rename `holiday` to `vacation` when
   * I already have a `vacation`" means in practice.
   *
   * `entity_tag` is keyed on tag id, so a rename that does *not* collide needs
   * no cascade at all. Callers still have to re-point label-keyed rows — saved
   * searches store tag labels, not ids — which is why `previousLabel` comes
   * back in the result.
   *
   * Returns null when the tag does not exist or belongs to another user.
   */
  async update(context: ServiceContext, id: string, data: UpdateTagDto): Promise<UpdateTagResult | null> {
    const scope = this.userScope(context);

    const existing = await this.tagRepository.findOne({ where: { id, ...scope } });

    if (existing == null) {
      return null;
    }

    const previousLabel = existing.label;
    const label = data.label === undefined ? previousLabel : this.validateLabel(data.label);
    const description = data.description === undefined ? existing.description : (data.description ?? null);

    if (label === previousLabel) {
      const tag = await this.applyTagFields(this.tagRepository.manager, id, { label, description });

      return { tag, merged: false, movedAssignments: 0, previousLabel };
    }

    return this.dataSource.transaction(async (manager) => {
      const tagRepository = manager.getRepository(TagEntity);

      // `withDeleted` on purpose: the unique constraint is not partial, so a
      // soft-deleted row still owns its label and would block the rename with
      // a constraint error the caller could do nothing about.
      const collision = await tagRepository.findOne({
        where: { label, userId: existing.userId },
        withDeleted: true,
      });

      if (collision != null && collision.deletedAt != null) {
        // Invisible to every read path and un-restorable through any UI — it
        // is only squatting on the label. Clear it out and rename normally.
        await this.purge(manager, collision.id);
      }

      if (collision != null && collision.deletedAt == null) {
        const movedAssignments = await this.mergeInto(manager, existing.id, collision.id);

        const tag = await this.applyTagFields(
          manager,
          collision.id,
          data.description === undefined ? {} : { description: data.description ?? null },
        );

        return { tag, merged: true, movedAssignments, previousLabel };
      }

      const tag = await this.applyTagFields(manager, id, { label, description });

      return { tag, merged: false, movedAssignments: 0, previousLabel };
    });
  }

  /**
   * Delete a tag and every assignment of it, for good.
   *
   * Deliberately a hard delete rather than the soft delete `TagEntity`'s
   * `deleted_at` column allows, for three reasons:
   *
   *   1. `entity_tag_tag_id_fkey` carries no ON DELETE rule, so the
   *      assignments have to go regardless — soft-deleting the parent would
   *      just leave them dangling behind a tag nothing can read.
   *   2. `tags_label_user_key` is not a partial index, so a soft-deleted tag
   *      keeps owning its label forever: re-tagging anything with that label
   *      would fail on a constraint the user cannot see or clear. Re-tagging
   *      is the most likely thing to follow a delete.
   *   3. A tag holds no history — just a label, a description and its
   *      assignments. The memories it was attached to are untouched, so the
   *      blast radius is small and nothing is recoverable-in-principle anyway.
   *
   * Returns null when the tag does not exist or belongs to another user.
   */
  async remove(context: ServiceContext, id: string): Promise<RemoveTagResult | null> {
    const existing = await this.tagRepository.findOne({
      where: { id, ...this.userScope(context) },
    });

    if (existing == null) {
      return null;
    }

    return this.dataSource.transaction(async (manager) => {
      const removedAssignments = await this.purge(manager, id);

      return { label: existing.label, removedAssignments };
    });
  }

  /**
   * How many entities carry each of the given tags, batched for
   * `TagType.entityCount`. Tags with no assignments are absent from the map.
   */
  async getAssignmentCounts(context: ServiceContext, tagIds: string[]): Promise<Map<string, number>> {
    if (tagIds.length === 0) {
      return new Map();
    }

    const query = this.dataSource
      .getRepository(EntityTagEntity)
      .createQueryBuilder('et')
      .select('et.tag_id', 'tag_id')
      .addSelect('COUNT(*)', 'count')
      .innerJoin(TagEntity, 't', 't.id = et.tag_id')
      .where('et.tag_id IN (:...tagIds)', { tagIds })
      .groupBy('et.tag_id');

    if (context.userId !== SYSTEM_USER) {
      query.andWhere('t.user_id = :userId', { userId: context.userId });
    }

    const rows: Array<{ tag_id: string; count: string }> = await query.getRawMany();

    return new Map(rows.map((row) => [row.tag_id, parseInt(row.count, 10)]));
  }

  async tagEntities(context: ServiceContext, data: TagEntitiesDto): Promise<boolean> {
    const labels = data.labels.map((label) => this.validateLabel(label));

    if (context.userId === SYSTEM_USER && data.forUserId == null) {
      throw new Error('System user cannot tag entities without a forUserId specified');
    }

    if (context.userId !== SYSTEM_USER && data.forUserId != null && data.forUserId !== context.userId) {
      throw new Error('Cannot tag entities for another user');
    }

    const userId = context.userId === SYSTEM_USER ? data.forUserId : context.userId;

    return this.dataSource.transaction(async (manager) => {
      const tagRepository = manager.getRepository(TagEntity);
      const entityTagRepository = manager.getRepository(EntityTagEntity);

      for (const label of labels) {
        let tagEntity = await tagRepository.findOne({
          where: {
            label,
            userId: userId,
          },
        });

        if (tagEntity == null) {
          const instance = tagRepository.create({
            id: uuid7(),
            label,
            userId,
          });

          tagEntity = await tagRepository.save(instance);
        }

        for (const entity of data.entities) {
          await entityTagRepository
            .createQueryBuilder()
            .insert()
            .values({
              tagId: tagEntity.id,
              entityType: entity.type,
              entityId: entity.id,
            })
            .orIgnore()
            .execute();
        }
      }

      return true;
    });
  }

  async untagEntities(context: ServiceContext, data: TagEntitiesDto): Promise<boolean> {
    const labels = data.labels.map((label) => this.validateLabel(label));

    if (context.userId === SYSTEM_USER && data.forUserId == null) {
      throw new Error('System user cannot untag entities without a forUserId specified');
    }

    if (context.userId !== SYSTEM_USER && data.forUserId != null && data.forUserId !== context.userId) {
      throw new Error('Cannot untag entities for another user');
    }

    const userId = context.userId === SYSTEM_USER ? data.forUserId : context.userId;

    return this.dataSource.transaction(async (manager) => {
      const tagRepository = manager.getRepository(TagEntity);
      const entityTagRepository = manager.getRepository(EntityTagEntity);

      for (const label of labels) {
        const tagEntity = await tagRepository.findOne({
          where: {
            label,
            userId: userId,
          },
        });

        if (tagEntity == null) {
          continue;
        }

        for (const entity of data.entities) {
          await entityTagRepository.delete({
            tagId: tagEntity.id,
            entityId: entity.id,
            entityType: entity.type,
          });
        }
      }

      return true;
    });
  }

  async getTagsForEntity(
    context: ServiceContext,
    entityId: EntityIdentifier<TaggableEntity>,
  ): Promise<TimestampedTag[]> {
    const { type, id } = entityId;

    const entityTagRepository = this.dataSource.getRepository(EntityTagEntity);

    const query = entityTagRepository
      .createQueryBuilder('et')
      .innerJoinAndSelect('et.tag', 'tag')
      .where('et.entityId = :entityId', { entityId: id })
      .andWhere('et.entityType = :entityType', { entityType: type });

    if (context.userId !== SYSTEM_USER) {
      query.andWhere('tag.userId = :userId', { userId: context.userId });
    }

    const entityTags = await query.getMany();

    return entityTags.map((et) => ({
      id: et.tag!.id,
      label: et.tag!.label,
      taggedAt: et.createdAt,
    }));
  }

  async getTagsForEntities(
    context: ServiceContext,
    entityIds: EntityIdentifier<TaggableEntity>[],
  ): Promise<Map<EntityIdentifier<TaggableEntity>, TimestampedTag[]>> {
    if (entityIds.length === 0) {
      return new Map();
    }

    const entityTagRepository = this.dataSource.getRepository(EntityTagEntity);
    const results = new Map<EntityIdentifier<TaggableEntity>, TimestampedTag[]>();

    const refMap = new Map<string, EntityIdentifier<TaggableEntity>>();
    const byType: Record<string, string[]> = {};

    for (const identifier of entityIds) {
      results.set(identifier, []);

      const compositeKey = `${identifier.type}:${identifier.id}`;

      refMap.set(compositeKey, identifier);

      if (byType[identifier.type] == null) {
        byType[identifier.type] = [];
      }

      byType[identifier.type].push(identifier.id);
    }

    await Promise.all(
      Object.entries(byType).map(async ([rawType, ids]) => {
        const entityType = rawType as TaggableEntity;

        const query = entityTagRepository
          .createQueryBuilder('et')
          .innerJoinAndSelect('et.tag', 'tag')
          .where('et.entityId IN (:...ids)', { ids })
          .andWhere('et.entityType = :entityType', { entityType });

        if (context.userId !== SYSTEM_USER) {
          query.andWhere('tag.userId = :userId', { userId: context.userId });
        }

        const entityTags = await query.getMany();

        for (const et of entityTags) {
          const compositeKey = `${et.entityType}:${et.entityId}`;
          const originalIdentifier = refMap.get(compositeKey);

          if (originalIdentifier) {
            results.get(originalIdentifier)?.push({
              id: et.tag!.id,
              label: et.tag!.label,
              taggedAt: et.createdAt,
            });
          }
        }
      }),
    );

    return results;
  }

  async getEntitiesForTag(context: UserServiceContext, label: string): Promise<EntityTag[]> {
    const tag = await this.findByLabel(context, label, {
      includeEntities: true,
    });

    if (tag == null || tag.entities == null) {
      return [];
    }

    return tag.entities;
  }

  async getEntitiesForTags(
    context: UserServiceContext,
    labels: string[],
  ): Promise<EntityIdentifier<TaggableEntity>[]> {
    const validatedLabels = labels.map((label) => this.validateLabel(label));
    const uniqueLabels = [...new Set(validatedLabels)];

    if (uniqueLabels.length === 0) {
      return [];
    }

    const query = this.dataSource
      .getRepository(EntityTagEntity)
      .createQueryBuilder('et')
      .select(['et.entity_id', 'et.entity_type'])
      .innerJoin(TagEntity, 't', 't.id = et.tag_id')
      .where('t.user_id = :userId', { userId: context.userId })
      .andWhere('t.label IN (:...labels)', { labels: uniqueLabels })
      .groupBy('et.entity_id')
      .addGroupBy('et.entity_type')
      .having('COUNT(DISTINCT t.label) = :count', { count: uniqueLabels.length });

    const results = await query.getRawMany();

    const mappedResults = results.map((row: { entity_id: string; entity_type: TaggableEntity }) => ({
      id: row.entity_id,
      type: row.entity_type,
    }));

    return mappedResults;
  }

  /**
   * The user's most-used tags: each live tag with how many entities carry it,
   * heaviest first. `entity_tag` is unique on (entity_type, entity_id, tag_id),
   * so COUNT(*) per tag is exactly the number of distinct tagged entities.
   * Ties break alphabetically so the ordering is stable across refreshes.
   * Powers the stats page's "Entities by tag" breakdown.
   */
  async getTagUsageCounts(
    context: UserServiceContext,
    limit: number,
  ): Promise<Array<{ label: string; count: number }>> {
    const rows: Array<{ label: string; count: string }> = await this.dataSource
      .getRepository(EntityTagEntity)
      .createQueryBuilder('et')
      .select('t.label', 'label')
      .addSelect('COUNT(*)', 'count')
      .innerJoin(TagEntity, 't', 't.id = et.tag_id')
      .where('t.user_id = :userId', { userId: context.userId })
      .andWhere('t.deleted_at IS NULL')
      .groupBy('t.label')
      .orderBy('count', 'DESC')
      .addOrderBy('t.label', 'ASC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => ({
      label: row.label,
      count: parseInt(row.count, 10),
    }));
  }

  /** User-scoping fragment shared by the owner-checked reads and writes. */
  private userScope(context: ServiceContext): { userId?: string } {
    return context.userId === SYSTEM_USER ? {} : { userId: context.userId };
  }

  /**
   * Write label/description onto a tag and read it back. The id is resolved by
   * the caller, which has already owner-checked it.
   */
  private async applyTagFields(
    manager: EntityManager,
    id: string,
    fields: { label?: string; description?: string | null },
  ): Promise<Tag> {
    const tagRepository = manager.getRepository(TagEntity);

    if (Object.keys(fields).length > 0) {
      await tagRepository.update({ id }, fields);
    }

    const entity = await tagRepository.findOneOrFail({ where: { id } });

    return TagEntity.toEgressType(entity);
  }

  /**
   * Re-point `sourceId`'s assignments onto `targetId`, then drop what is left
   * of the source. Assignments the target already holds are skipped rather
   * than moved — `entity_tag_unique_entry` would reject them — and then
   * deleted along with the source tag.
   *
   * @returns the number of assignments actually moved
   */
  private async mergeInto(manager: EntityManager, sourceId: string, targetId: string): Promise<number> {
    const moved: [unknown[], number] = await manager.query(
      `UPDATE ci_search.entity_tag t
          SET tag_id = $2
        WHERE t.tag_id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM ci_search.entity_tag d
             WHERE d.tag_id = $2
               AND d.entity_type = t.entity_type
               AND d.entity_id = t.entity_id)`,
      [sourceId, targetId],
    );

    await this.purge(manager, sourceId);

    return moved[1] ?? 0;
  }

  /**
   * Delete a tag and its assignments, in that dependency order. Callers own
   * the ownership check and the surrounding transaction.
   *
   * @returns the number of assignments deleted with it
   */
  private async purge(manager: EntityManager, id: string): Promise<number> {
    const assignments = await manager.getRepository(EntityTagEntity).delete({ tagId: id });

    await manager.getRepository(TagEntity).delete({ id });

    return assignments.affected ?? 0;
  }

  private validateLabel(label?: string): string {
    const validatedLabel = (label?.trim() || '').toLowerCase();

    if (validatedLabel.length === 0) {
      throw new Error('Tag label cannot be empty');
    }

    return validatedLabel;
  }
}
