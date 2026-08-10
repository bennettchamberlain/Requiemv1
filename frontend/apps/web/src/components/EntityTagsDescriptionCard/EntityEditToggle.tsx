import { Toggle, Tooltip } from '@ci/shadcn';
import { Pencil } from '@ci/shadcn/icons';
import { useTranslation } from 'react-i18next';

interface Props {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/**
 * The pencil that flips an entity page into edit mode, driving
 * {@link EntityTagsDescriptionCard}. Identical on every entity page, so it lives
 * here rather than being restated seven times.
 */
export function EntityEditToggle({ pressed, onPressedChange }: Props) {
  const { t } = useTranslation();

  return (
    <Tooltip delayDuration={600}>
      <Tooltip.Content>{t('ENTITY_EDIT_TOGGLE')}</Tooltip.Content>
      {/* The span is load-bearing: Tooltip.Trigger writes its own `data-state`,
          and a Toggle placed directly inside it would have its on/off state
          overwritten, silently killing every data-[state=on] rule below. */}
      <Tooltip.Trigger asChild>
        <span className="inline-flex">
          <Toggle
            aria-label={t('ENTITY_EDIT_TOGGLE')}
            size="sm"
            variant="outline"
            className="data-[state=on]:bg-transparent data-[state=on]:*:[svg]:fill-blue-500 data-[state=on]:*:[svg]:stroke-blue-500"
            pressed={pressed}
            onPressedChange={onPressedChange}
          >
            <Pencil />
          </Toggle>
        </span>
      </Tooltip.Trigger>
    </Tooltip>
  );
}
