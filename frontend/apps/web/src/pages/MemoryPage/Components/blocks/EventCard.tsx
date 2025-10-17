import { Card, Tooltip } from '@ci/shadcn';
import { Calendar, Clock, User, MapPin, Link, Repeat, Timer } from '@ci/shadcn/icons';

import { RelationshipsSection } from '../RelationshipsSection';
import type { MemoryCardProps } from '../types';
import { formatDateTime, formatDuration } from '../utils';

export function EventCard({ memory }: MemoryCardProps) {
  const hasStartDate = memory.startDate;
  const hasEndDate = memory.endDate;
  const hasOrganizer = memory.organizer;
  const hasRepeating = memory.repeatingFrequency;
  const hasDuration = memory.duration;
  const hasSource = memory.source;
  const hasSourceLink = memory.sourceLink;
  const hasLocation = memory.location?.name || memory.location?.address;
  const hasDescription = memory.description;

  return (
    <Card className="!gap-2 !py-4 px-6">
      <div className="flex items-start gap-3">
        <Calendar className="h-6 w-6 text-blue-600 flex-shrink-0 mt-1" />
        <div className="flex-1 min-w-0">
          <Tooltip>
            <Tooltip.Trigger asChild>
              <h3 className="text-lg font-semibold text-gray-900 truncate cursor-default">{memory.title}</h3>
            </Tooltip.Trigger>
            <Tooltip.Content>
              <p>{memory.title}</p>
            </Tooltip.Content>
          </Tooltip>
          <p className="text-sm text-gray-600">{memory.category}</p>
        </div>
      </div>

      {hasStartDate && (
        <div className="flex items-center gap-5">
          <Clock className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-medium text-gray-700">Start:</span>
            <span className="ml-2 text-sm text-gray-900">
              {formatDateTime(memory.startDate || '', memory.startTime || undefined)}
            </span>
          </div>
        </div>
      )}

      {hasEndDate && (
        <div className="flex items-center gap-5">
          <Clock className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-medium text-gray-700">End:</span>
            <span className="ml-2 text-sm text-gray-900">
              {formatDateTime(memory.endDate || '', memory.endTime || undefined)}
            </span>
          </div>
        </div>
      )}

      {hasOrganizer && (
        <div className="flex items-center gap-5">
          <User className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-medium text-gray-700">Organizer:</span>
            <span className="ml-2 text-sm text-gray-900">{memory.organizer}</span>
          </div>
        </div>
      )}

      {hasRepeating && (
        <div className="flex items-center gap-5">
          <Repeat className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-medium text-gray-700">Repeats:</span>
            <span className="ml-2 text-sm text-gray-900">{memory.repeatingFrequency}</span>
          </div>
        </div>
      )}

      {hasDuration && (
        <div className="flex items-center gap-5">
          <Timer className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-medium text-gray-700">Duration:</span>
            <span className="ml-2 text-sm text-gray-900">{formatDuration(memory.duration || 0)}</span>
          </div>
        </div>
      )}

      {hasLocation && (
        <div className="flex items-center gap-5">
          <MapPin className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-medium text-gray-700">Location:</span>
            <span className="ml-2 text-sm text-gray-900">{hasLocation}</span>
          </div>
        </div>
      )}

      {hasSource && (
        <div className="flex items-center gap-5">
          <span className="text-sm font-medium text-gray-700">Source:</span>
          <span className="text-sm text-gray-900">{memory.source}</span>
        </div>
      )}

      {hasSourceLink && (
        <div className="flex items-center gap-5">
          <Link className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <div className="min-w-0">
            <a
              href={memory.sourceLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              View source
            </a>
          </div>
        </div>
      )}

      {hasDescription && (
        <div className="pt-3 pb-3">
          <p className="text-sm text-gray-700 leading-relaxed">{memory.description}</p>
        </div>
      )}

      <RelationshipsSection relationships={memory.metadata?.relationships} />
    </Card>
  );
}
