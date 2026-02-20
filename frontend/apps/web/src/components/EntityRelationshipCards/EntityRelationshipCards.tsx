import { useEffect, useMemo, useRef, useState } from 'react';

import { Card } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import { useNodeGraphService } from '@/api/useNodeGraphService';

const CARD_MIN_WIDTH = 180;
const CARD_GAP_PX = 12;
const MAX_VISIBLE_CARDS = 10;
const DEFAULT_VISIBLE_CARDS = 5;

type RelationshipCard = {
  relationshipId: string;
  relationshipType: string;
  otherEntityId: string;
  otherEntityName: string;
  otherEntityType: string;
};

interface Props {
  entityId: string;
}

function formatRelationshipLabel(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function shuffleItems<T>(items: T[]): T[] {
  const shuffled = [...items];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }

  return shuffled;
}

function getVisibleCardCount(width: number): number {
  if (width <= 0) {
    return DEFAULT_VISIBLE_CARDS;
  }

  const cardsPerRow = Math.max(1, Math.floor((width + CARD_GAP_PX) / (CARD_MIN_WIDTH + CARD_GAP_PX)));

  if (width >= 1200) {
    return Math.min(MAX_VISIBLE_CARDS, Math.max(DEFAULT_VISIBLE_CARDS, cardsPerRow));
  }

  return Math.min(MAX_VISIBLE_CARDS, cardsPerRow);
}

function getEntityDetailPath(entityType: string, entityId: string): string | null {
  switch (entityType.toLowerCase()) {
    case 'person':
      return `/people/${entityId}`;
    case 'place':
      return `/places/${entityId}`;
    case 'content':
      return `/content/${entityId}`;
    case 'communication':
      return `/communications/${entityId}`;
    case 'item':
      return `/items/${entityId}`;
    case 'event':
      return `/events/${entityId}`;
    case 'concept':
      return `/concepts/${entityId}`;
    case 'note':
      return `/notes/${entityId}`;
    default:
      return null;
  }
}

export function EntityRelationshipCards({ entityId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visibleCardCount, setVisibleCardCount] = useState(DEFAULT_VISIBLE_CARDS);

  const { data, loading } = useNodeGraphService({
    entityId,
    maxDepth: 1,
    nodeLimit: 120,
    skip: !entityId,
  });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setVisibleCardCount(getVisibleCardCount(entry.contentRect.width));
      }
    });

    observer.observe(element);
    setVisibleCardCount(getVisibleCardCount(element.clientWidth));

    return () => observer.disconnect();
  }, []);

  const relationshipCards = useMemo<RelationshipCard[]>(() => {
    if (!data) {
      return [];
    }

    const nodeById = new Map(data.nodes.map((node) => [node.id, node]));

    return data.links
      .filter((link) => link.source === entityId || link.target === entityId)
      .map((link) => {
        const otherEntityId = link.source === entityId ? link.target : link.source;
        const otherNode = nodeById.get(otherEntityId);

        return {
          relationshipId: link.relationship_id,
          relationshipType: link.relationship_type,
          otherEntityId,
          otherEntityName: otherNode?.name ?? 'Unnamed Entity',
          otherEntityType: otherNode?.entity_type ?? 'unknown',
        };
      });
  }, [data, entityId]);

  const shuffledCards = useMemo(() => shuffleItems(relationshipCards), [relationshipCards]);
  const visibleCards = shuffledCards.slice(0, visibleCardCount);

  if (!loading && relationshipCards.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Relationship Cards
        </h2>
      </div>

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, visibleCards.length)}, minmax(0, 1fr))`,
        }}
      >
        {loading &&
          Array.from({ length: visibleCardCount }).map((_, idx) => (
            <Card key={`loading-${idx}`} className="p-0 min-h-[96px] animate-pulse">
              <Card.Content className="p-3 flex flex-col gap-2">
                <div className="h-4 w-2/3 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
              </Card.Content>
            </Card>
          ))}

        {!loading &&
          visibleCards.map((card) => {
            const detailPath = getEntityDetailPath(card.otherEntityType, card.otherEntityId);

            if (!detailPath) {
              return (
                <Card key={card.relationshipId} className="p-0 min-h-[96px]">
                  <Card.Content className="p-3 flex flex-col gap-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {formatRelationshipLabel(card.relationshipType)}
                    </p>
                    <p className="text-sm font-semibold leading-tight line-clamp-2">{card.otherEntityName}</p>
                    <p className="text-xs text-muted-foreground uppercase">{card.otherEntityType}</p>
                  </Card.Content>
                </Card>
              );
            }

            return (
              <Link key={card.relationshipId} to={detailPath} className="block">
                <Card className="p-0 min-h-[96px] transition-colors hover:bg-accent/40">
                  <Card.Content className="p-3 flex flex-col gap-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {formatRelationshipLabel(card.relationshipType)}
                    </p>
                    <p className="text-sm font-semibold leading-tight line-clamp-2">{card.otherEntityName}</p>
                    <p className="text-xs text-muted-foreground uppercase">{card.otherEntityType}</p>
                  </Card.Content>
                </Card>
              </Link>
            );
          })}
      </div>
    </div>
  );
}
