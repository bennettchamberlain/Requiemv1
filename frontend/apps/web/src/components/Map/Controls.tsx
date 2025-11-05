import { useState } from 'react';
import type { ComponentProps } from 'react';

import { Button, ButtonGroup, Toggle, cn } from '@ci/shadcn';
import { Plus, Minus, Route } from '@ci/shadcn/icons';
import { useMap } from 'react-leaflet';

import { Panel } from './Panel';

type Position = ComponentProps<typeof Panel>['position'];

interface Props {
  className?: string;
  position?: Position;
}

export function Controls({ className, position = 'top-left' }: Props) {
  const map = useMap();

  const zoomIn = () => {
    map.zoomIn();
  };

  const zoomOut = () => {
    map.zoomOut();
  };

  const [timelineVisible, setTimelineVisible] = useState(true);

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

        <Toggle
          pressed={timelineVisible}
          onPressedChange={() => setTimelineVisible(!timelineVisible)}
          aria-label="Toggle timeline"
          className={cn(
            'cursor-pointer',
            timelineVisible
              ? 'bg-blue-500! text-primary-foreground!'
              : 'bg-primary-foreground! text-foreground!',
          )}
        >
          <Route />
        </Toggle>
      </div>
    </Panel>
  );
}
