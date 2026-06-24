import type { ComponentProps } from 'react';

import { Button, ButtonGroup, Tooltip, cn } from '@ci/shadcn';
import { Crosshair, Plus, Minus, Route } from '@ci/shadcn/icons';

import { Panel } from './Panel';
import { useMap } from './useMap';

type Position = Exclude<ComponentProps<typeof Panel>['position'], 'top' | 'bottom' | 'left' | 'right'>;

interface Props {
  className?: string;
  position?: Position;
}

export function Controls({ className, position = 'top-left' }: Props) {
  const [{ displayRoutes }, { toggleRoutes, zoomIn, zoomOut, centerVisibleMarkers }] = useMap();
  const tooltipSide = position.includes('right') ? 'left' : 'right';

  return (
    <Panel position={position} className={cn('p-2', className)}>
      <Tooltip.Provider>
        <div className="flex flex-col gap-2">
          <ButtonGroup orientation="vertical">
            <Tooltip delayDuration={600}>
              <Tooltip.Content side={tooltipSide}>Zoom in</Tooltip.Content>
              <Tooltip.Trigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={zoomIn}
                  className="text-slate-700! bg-white! hover:bg-gray-100! border-gray-200!"
                >
                  <Plus />
                </Button>
              </Tooltip.Trigger>
            </Tooltip>

            <Tooltip delayDuration={600}>
              <Tooltip.Content side={tooltipSide}>Zoom out</Tooltip.Content>
              <Tooltip.Trigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={zoomOut}
                  className="text-slate-700! bg-white! hover:bg-gray-100! border-gray-200!"
                >
                  <Minus />
                </Button>
              </Tooltip.Trigger>
            </Tooltip>
          </ButtonGroup>

          <Tooltip delayDuration={600}>
            <Tooltip.Content side={tooltipSide}>Center visible pins</Tooltip.Content>
            <Tooltip.Trigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={centerVisibleMarkers}
                className="text-slate-700! bg-white! hover:bg-gray-100! border-gray-200!"
              >
                <Crosshair />
              </Button>
            </Tooltip.Trigger>
          </Tooltip>

          <Tooltip delayDuration={600}>
            <Tooltip.Content side={tooltipSide}>Toggle routes</Tooltip.Content>
            <Tooltip.Trigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={toggleRoutes}
                className={cn(
                  displayRoutes
                    ? 'bg-blue-500! text-white! hover:bg-blue-400! border-blue-400!'
                    : 'text-slate-700! bg-white! hover:bg-gray-100! border-gray-200!',
                )}
              >
                <Route />
              </Button>
            </Tooltip.Trigger>
          </Tooltip>
        </div>
      </Tooltip.Provider>
    </Panel>
  );
}
