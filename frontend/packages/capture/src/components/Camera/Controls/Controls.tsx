import { Tooltip } from '@ci/shadcn';
import { type ReactNode } from 'react';

import { Divider } from './Divider';
import { Icon } from './Icon';
import { useDeviceLayout } from '@ci/common';

interface Props {
  children: ReactNode;
}

function Controls({ children }: Props) {
  const { isMobile } = useDeviceLayout();

  if (isMobile) {
    return (
      <div className="w-full px-14 flex flex-row items-center justify-between pb-[max(2.5rem,env(safe-area-inset-bottom))] select-none">
        {children}
      </div>
    );
  }

  return (
    <Tooltip.Provider>
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex p-1 gap-1 rounded-lg bg-black/60 backdrop-blur-sm">
        {children}
      </div>
    </Tooltip.Provider>
  );
}

type ControlsComponent = typeof Controls & {
  Icon: typeof Icon;
  Divider: typeof Divider;
};

const AugmentedControls = Controls as ControlsComponent;

AugmentedControls.Icon = Icon;
AugmentedControls.Divider = Divider;

export { AugmentedControls as Controls };
