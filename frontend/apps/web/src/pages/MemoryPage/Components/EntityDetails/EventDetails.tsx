import { Input, Label, Sheet } from '@ci/shadcn';

import type { FragmentType } from '@/graphql';
import type { EVENT_FRAGMENT } from '@/pages/MemoryPage/Components/EntityCard/EventCard.tsx';

interface Props {
  entity: FragmentType<EVENT_FRAGMENT>;
}

export function EventDetails({ entity }: Props) {
  return (
    <Sheet.Content className="z-index-1000">
      <Sheet.Header>
        <Sheet.Title>{entity.title}</Sheet.Title>
        <Sheet.Description>{entity.description}</Sheet.Description>
      </Sheet.Header>
      <div className="grid flex-1 auto-rows-min gap-6 px-4">
        {entity?.location != null && (
          <div className="grid flex-1 auto-rows-min gap-6">
            <Label className="text-xl">Location</Label>
            {entity.location.name && (
              <div className="grid gap-3">
                <Label htmlFor="address">Name</Label>
                <Input id="address" disabled defaultValue={entity.location.name} />
              </div>
            )}
            <div className="grid gap-3">
              <Label htmlFor="address">Address</Label>
              <Input id="address" disabled defaultValue={entity.location.properties.address} />
            </div>

            <div className="grid gap-3">
              <Label htmlFor="coordinates">Coordinates</Label>
              <Input
                id="coordinates"
                disabled
                defaultValue={`Latitude: ${entity.location.properties.latitude}, Longitude: ${entity.location.properties.longitude}`}
              />
            </div>
          </div>
        )}
        {entity.metadata?.sourceSystem != null && (
          <div className="grid flex-1 auto-rows-min gap-6 px-4">
            <div className="grid gap-3">
              <Label htmlFor="sourceSystem">Platform</Label>
              <Input id="sourceSystem" disabled defaultValue={entity.metadata.sourceSystem as string} />
            </div>
            )
          </div>
        )}
        {entity?.startTime != null && (
          <div className="grid gap-3">
            <Label htmlFor="startTime">Start Time</Label>
            <Input id="startTime" disabled defaultValue={new Date(entity.startTime).toLocaleString()} />
          </div>
        )}
        {entity?.endTime != null && (
          <div className="grid gap-3">
            <Label htmlFor="endTime">End Time</Label>
            <Input id="endTime" disabled defaultValue={new Date(entity.endTime).toLocaleString()} />
          </div>
        )}
        {entity?.durationMinutes != null && (
          <div className="grid gap-3">
            <Label htmlFor="duration">Duration</Label>
            <Input
              id="duration"
              disabled
              defaultValue={`${Math.floor((entity.durationMinutes as number) / 60)} hours, ${(entity.durationMinutes as number) % 60} minutes`}
            />
          </div>
        )}
      </div>
    </Sheet.Content>
  );
}
