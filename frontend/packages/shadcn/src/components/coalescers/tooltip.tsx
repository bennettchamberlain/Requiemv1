import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';

type TooltipComponent = typeof Tooltip & {
  Trigger: typeof TooltipTrigger;
  Content: typeof TooltipContent;
};

const AugmentedTooltip = Tooltip as TooltipComponent;

AugmentedTooltip.Trigger = TooltipTrigger;
AugmentedTooltip.Content = TooltipContent;

export { AugmentedTooltip as Tooltip };
