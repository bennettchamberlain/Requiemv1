import { IconButton } from '@ci/shadcn';
import { Camera } from '@ci/shadcn/icons';
import { useTranslation } from 'react-i18next';

interface Props {
  openModal: () => void;
}

export function CaptureModalToggle({ openModal }: Props) {
  const { t } = useTranslation();

  return (
    <IconButton variant="ghost" onClick={openModal} label={t('CAPTURE_OPEN')}>
      <Camera className="h-4 w-4" />
    </IconButton>
  );
}
