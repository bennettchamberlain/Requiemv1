import { Card, Badge } from '@ci/shadcn';
import { Image, Calendar, MapPin, Clock, User, Repeat, Timer, Link } from '@ci/shadcn/icons';

import { formatDateTime, formatDuration } from '@/pages/MemoryPage/Components';
import { truncateText } from '@/pages/MemoryPage/ListView/utils.tsx';
import type { MemoryItem } from '@/pages/MemoryPage/types.ts';

export interface Props {
  result: MemoryItem;
}

export function EventCard({ result }: Props) {
  console.log('event result', result);
  const hasStartDate = result.startDate;
  const hasEndDate = result.endDate;
  const hasOrganizer = result.organizer;
  const hasRepeating = result.repeatingFrequency;
  const hasDuration = result.duration;
  const hasSource = result.source;
  const hasSourceLink = result.sourceLink;
  const hasLocation = result.location?.name || result.location?.address;
  const hasDescription = result.description;

  return (
    <Card className="group hover:shadow-lg transition-shadow duration-200 overflow-hidden">
      <Card.Header className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Badge
            variant="secondary"
            className={`bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 flex items-center gap-1`}
          >
            <Image className="h-4 w-4" />
            <span className="capitalize">{result.type}</span>
          </Badge>
          <Badge
            variant="secondary"
            className={`bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 flex items-center gap-1`}
          >
            <Calendar className="w-4 h-4" />
            <span className="capitalize">Event</span>
          </Badge>
          <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            {result.id.substring(0, 8)}...
          </code>
        </div>
      </Card.Header>

      <Card.Content>
        {result?.title && (
          <p className="text-sm text-muted-foreground line-clamp-4">{truncateText(result.title, 200)}</p>
        )}
        {hasStartDate && (
          <div className="flex items-center gap-5">
            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-sm font-medium text-muted-foreground">Start:</span>
              <span className="ml-2 text-sm text-card-foreground">
                {formatDateTime(result.startDate || '', result.startTime || undefined)}
              </span>
            </div>
          </div>
        )}

        {hasEndDate && (
          <div className="flex items-center gap-5">
            <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-sm font-medium text-muted-foreground">End:</span>
              <span className="ml-2 text-sm text-card-foreground">
                {formatDateTime(result.endDate || '', result.endTime || undefined)}
              </span>
            </div>
          </div>
        )}

        {hasOrganizer && (
          <div className="flex items-center gap-5">
            <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-sm font-medium text-muted-foreground">Organizer:</span>
              <span className="ml-2 text-sm text-card-foreground">{result.organizer}</span>
            </div>
          </div>
        )}

        {hasRepeating && (
          <div className="flex items-center gap-5">
            <Repeat className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-sm font-medium text-muted-foreground">Repeats:</span>
              <span className="ml-2 text-sm text-card-foreground">{result.repeatingFrequency}</span>
            </div>
          </div>
        )}

        {hasDuration && (
          <div className="flex items-center gap-5">
            <Timer className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-sm font-medium text-muted-foreground">Duration:</span>
              <span className="ml-2 text-sm text-card-foreground">
                {formatDuration(result.duration || 0)}
              </span>
            </div>
          </div>
        )}

        {hasLocation && (
          <div className="flex items-center gap-5">
            <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-sm font-medium text-muted-foreground">Location:</span>
              <span className="ml-2 text-sm text-card-foreground">{hasLocation}</span>
            </div>
          </div>
        )}

        {hasSource && (
          <div className="flex items-center gap-5">
            <span className="text-sm font-medium text-muted-foreground">Source:</span>
            <span className="text-sm text-card-foreground">{result.source}</span>
          </div>
        )}

        {hasSourceLink && (
          <div className="flex items-center gap-5">
            <Link className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0">
              <a
                href={result.sourceLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:text-primary/80 underline"
                onClick={(e) => e.stopPropagation()}
              >
                View source
              </a>
            </div>
          </div>
        )}

        {hasDescription && (
          <div className="pt-3 pb-3">
            <p className="text-sm text-muted-foreground leading-relaxed">{result.description}</p>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
