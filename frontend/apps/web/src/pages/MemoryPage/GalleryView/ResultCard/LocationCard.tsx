import { Card, Badge } from '@ci/shadcn';
import {
  BadgeQuestionMark,
  MapPin,
  House,
  Building,
  Dumbbell,
  Music,
  TreePine,
  Hospital,
  TreePalm,
  School,
} from '@ci/shadcn/icons';

import { truncateText } from '@/pages/MemoryPage/ListView/utils.tsx';
import type { MemoryItem } from '@/pages/MemoryPage/types.ts';

export interface Props {
  result: MemoryItem;
}

function getLocationType(type: string) {
  switch (type.toLowerCase()) {
    case 'residence':
    case 'home':
      return <House className="h-4 w-4" />;
    case 'work site':
      return <Building className="h-4 w-4" />;
    case 'gym':
      return <Dumbbell className="h-4 w-4" />;
    case 'conference center':
      return <Building className="h-4 w-4" />;
    case 'music studio':
      return <Music className="h-4 w-4" />;
    case 'park':
      return <TreePine className="h-4 w-4" />;
    case 'clinic':
      return <Hospital className="h-4 w-4" />;
    case 'hotel':
      return <TreePalm className="h-4 w-4" />;
    case 'school':
      return <School className="h-4 w-4" />;
    default:
      return <BadgeQuestionMark className="h-4 w-4" />;
  }
}

export function LocationCard({ result }: Props) {
  return (
    <Card className="group hover:shadow-lg transition-shadow duration-200 overflow-hidden">
      <Card.Header className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Badge
            variant="secondary"
            className={`bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 flex items-center gap-1`}
          >
            <MapPin className="h-4 w-4" />
            <span className="capitalize">{result.category}</span>
          </Badge>
          <Badge
            variant="secondary"
            className={`bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 flex items-center gap-1`}
          >
            {getLocationType(result?.metadata?.properties?.type || '')}
            <span className="capitalize">{result?.metadata?.properties?.type}</span>
          </Badge>
          <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            {result.id.substring(0, 8)}...
          </code>
        </div>
      </Card.Header>

      <Card.Content>
        {result?.title && (
          <p className="text-sm text-foreground line-clamp-4">{truncateText(result.title, 200)}</p>
        )}

        {result?.location?.lat != null && result?.location?.lng != null && (
          <div className="mt-4 pt-4">
            <div className="flex flex-wrap gap-2">
              <div className="text-xs">
                <span className="text-muted-foreground mr-2">{`Latitude: ${result.location.lat}`}</span>
                <span className="text-muted-foreground">{`Longitude: ${result.location.lng}`}</span>
              </div>
            </div>
          </div>
        )}

        {result?.description != null && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex flex-wrap gap-2">
              <div className="text-xs">
                <span className="text-muted-foreground">{result.description}</span>
              </div>
            </div>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
