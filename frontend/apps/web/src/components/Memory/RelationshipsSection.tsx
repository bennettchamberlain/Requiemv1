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
    <div className="pt-3 border-t border-gray-200">
      <Accordion type="single" collapsible className="w-full">
        <Accordion.Item value="relationships">
          <Accordion.Trigger className="text-sm font-medium text-gray-700 hover:text-gray-900">
            Relationships ({relationships.length})
          </Accordion.Trigger>
          <Accordion.Content>
            <div className="space-y-3 pt-2">
              {outgoingRels.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
                    <ArrowRight className="h-3 w-3" />
                    Outgoing
                  </h4>
                  <div className="space-y-2">
                    {outgoingRels.map((rel: Relationship, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 p-2 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex-shrink-0 mt-0.5 text-gray-500">
                          {getEntityTypeIcon(rel.targetType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-blue-600 uppercase">
                              {rel.type.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-gray-400">→</span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 truncate">{rel.targetName}</p>
                          <p className="text-xs text-gray-500">{rel.targetType}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {incomingRels.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
                    <ArrowLeft className="h-3 w-3" />
                    Incoming
                  </h4>
                  <div className="space-y-2">
                    {incomingRels.map((rel: Relationship, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 p-2 bg-gray-50 rounded-md hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex-shrink-0 mt-0.5 text-gray-500">
                          {getEntityTypeIcon(rel.targetType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-medium text-purple-600 uppercase">
                              {rel.type.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-gray-400">←</span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 truncate">{rel.targetName}</p>
                          <p className="text-xs text-gray-500">{rel.targetType}</p>
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
