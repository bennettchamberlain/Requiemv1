import { Input, Label, Sheet } from '@ci/shadcn';

import type { BROWSER_ACTIVITY_FRAGMENT } from '../EntityCard/BrowserActivityCard.tsx';

interface Props {
  entity: FragmentType<typeof BROWSER_ACTIVITY_FRAGMENT>;
}

export function BrowserActivityDetails({ entity }: Props) {
  return (
    <Sheet.Content className="z-index-1000">
      <Sheet.Header>
        <Sheet.Title>
          {entity.actionType[0].toUpperCase() + entity.actionType.slice(1)} - {entity.title}
        </Sheet.Title>
        <Sheet.Description>
          <div
            className="hover:text-blue-500 cursor-pointer"
            onClick={() => window.open(entity.url, '_blank')}
          >
            {entity.url}
          </div>
        </Sheet.Description>
      </Sheet.Header>
      <div className="grid flex-1 auto-rows-min gap-6 px-4">
        <div className="grid gap-3">
          <Label htmlFor="startTime">Start Time</Label>
          <Input id="startTime" disabled defaultValue={new Date(entity.time).toLocaleString()} />
        </div>
      </div>
    </Sheet.Content>
  );
}
