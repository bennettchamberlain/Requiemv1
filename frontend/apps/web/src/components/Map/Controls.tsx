import type { ComponentProps } from 'react';

import { Button, ButtonGroup, Toggle, cn } from '@ci/shadcn';
import { Crosshair, Plus, Minus, Route } from '@ci/shadcn/icons';

import { Panel } from './Panel';
import { useMap } from './useMap';

type Position = ComponentProps<typeof Panel>['position'];

interface Props {
  className?: string;
  position?: Position;
}

export function Controls({ className, position = 'top-left' }: Props) {
  const [{ displayRoutes }, { toggleRoutes, zoomIn, zoomOut, centerVisibleMarkers }] = useMap();

  return (
    <Panel position={position} className={cn('p-2', className)}>
      <div className="flex flex-col gap-2">
        <ButtonGroup orientation="vertical">
          <Button variant="outline" size="icon" onClick={zoomIn}>
            <Plus />
          </Button>

          <Button variant="outline" size="icon" onClick={zoomOut}>
            <Minus />
          </Button>
        </ButtonGroup>

        <Button variant="outline" size="icon" onClick={centerVisibleMarkers}>
          <Crosshair />
        </Button>

        <Toggle
          pressed={displayRoutes}
          onPressedChange={toggleRoutes}
          aria-label="Toggle timeline"
          className={cn(
            'cursor-pointer',
            displayRoutes
              ? 'bg-blue-600! text-primary-foreground! border-2 border-blue-500!'
              : 'bg-primary-foreground! text-foreground!',
          )}
        >
          <Route />
        </Toggle>
      </div>
    </Panel>
  );
}
