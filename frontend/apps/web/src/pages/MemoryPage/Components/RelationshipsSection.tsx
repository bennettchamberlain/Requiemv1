import { Accordion } from '@ci/shadcn';
import { ArrowRight, ArrowLeft } from '@ci/shadcn/icons';

import type { Relationship } from './types';
import { getEntityTypeIcon } from './utils';

interface RelationshipsSectionProps {
  relationships?: Relationship[];
}

export function RelationshipsSection({ relationships }: RelationshipsSectionProps) {
  if (!relationships || relationships.length === 0) {
    return null;
  }

  const outgoingRels = relationships.filter((r: Relationship) => r.direction === 'outgoing');
  const incomingRels = relationships.filter((r: Relationship) => r.direction === 'incoming');

  return (
    <div className="pt-3 border-t border-border">
      <Accordion type="single" collapsible className="w-full">
        <Accordion.Item value="relationships">
          <Accordion.Trigger className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Relationships ({relationships.length})
          </Accordion.Trigger>
          <Accordion.Content>
            <div className="space-y-3 pt-2">
              {outgoingRels.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                    <ArrowRight className="h-3 w-3" />
                    Outgoing
                  </h4>
                  <div className="space-y-2">
                    {outgoingRels.map((rel: Relationship, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 p-2 bg-muted rounded-md hover:bg-accent transition-colors"
                      >
                        <div className="flex-shrink-0 mt-0.5 text-muted-foreground">
                          {getEntityTypeIcon(rel.targetType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-primary uppercase">
                              {rel.type.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-muted-foreground">→</span>
                          </div>
                          <p className="text-sm font-medium text-foreground truncate">{rel.targetName}</p>
                          <p className="text-xs text-muted-foreground">{rel.targetType}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {incomingRels.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                    <ArrowLeft className="h-3 w-3" />
                    Incoming
                  </h4>
                  <div className="space-y-2">
                    {incomingRels.map((rel: Relationship, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 p-2 bg-muted rounded-md hover:bg-accent transition-colors"
                      >
                        <div className="flex-shrink-0 mt-0.5 text-muted-foreground">
                          {getEntityTypeIcon(rel.targetType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-accent-foreground uppercase">
                              {rel.type.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-muted-foreground">←</span>
                          </div>
                          <p className="text-sm font-medium text-foreground truncate">{rel.targetName}</p>
                          <p className="text-xs text-muted-foreground">{rel.targetType}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
    </div>
  );
}
