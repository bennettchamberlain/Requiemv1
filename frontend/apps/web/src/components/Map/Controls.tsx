import type { ComponentProps } from 'react';

import { Button, ButtonGroup, cn } from '@ci/shadcn';
import { Plus, Minus } from '@ci/shadcn/icons';
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

  return (
    <Panel position={position} className={cn('p-2', className)}>
      <ButtonGroup orientation="vertical">
        <Button variant="outline" size="icon" onClick={zoomIn}>
          <Plus />
        </Button>

        <Button variant="outline" size="icon" onClick={zoomOut}>
          <Minus />
        </Button>
      </ButtonGroup>
    </Panel>
  );
}
