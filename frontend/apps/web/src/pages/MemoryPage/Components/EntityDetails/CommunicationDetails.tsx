import { Input, Label, Sheet } from '@ci/shadcn';

import type { COMMUNICATION_FRAGMENT } from '../EntityCard/CommunicationCard.tsx';

interface Props {
  entity: FragmentType<typeof COMMUNICATION_FRAGMENT>;
}

export function CommunicationDetails({ entity }: Props) {
  return (
    <Sheet.Content className="z-index-1000">
      <Sheet.Header>
        <Sheet.Title>
          {entity.direction[0].toUpperCase() + entity.direction.slice(1)}{' '}
          {entity.type[0].toUpperCase() + entity.type.slice(1)} - {entity.subject || entity.preview}
        </Sheet.Title>
        <Sheet.Description>{entity.description}</Sheet.Description>
      </Sheet.Header>
      <div className="grid flex-1 auto-rows-min gap-6 px-4">
        <Sheet.Description>{entity.communicationContent}</Sheet.Description>
        {entity.from && (
          <div className="grid gap-3">
            <Sheet.Title>From</Sheet.Title>
            <Sheet.Description>{entity.from.name}</Sheet.Description>
          </div>
        )}
        {entity.to?.edges?.length > 0 && (
          <div className="grid gap-3">
            <Sheet.Title>To</Sheet.Title>
            {entity.to.edges.map((person) => (
              <Sheet.Description>{person.node.name}</Sheet.Description>
            ))}
          </div>
        )}
        <div className="grid gap-3">
          <Label htmlFor="startTime">Start Time</Label>
          <Input id="startTime" disabled defaultValue={new Date(entity.time).toLocaleString()} />
        </div>
      </div>
    </Sheet.Content>
  );
}
