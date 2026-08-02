import { Button, cn } from '@ci/shadcn';

import './brand-primary-button.css';

type BrandPrimaryButtonProps = React.ComponentProps<typeof Button>;

/** CI Planning teal gradient primary button (replaces global mint CTA). */
export function BrandPrimaryButton({ className, variant, ...props }: BrandPrimaryButtonProps) {
  const isPrimary = variant == null || variant === 'default';

  return (
    <Button
      className={cn(isPrimary && 'ci-brand-btn-primary', className)}
      variant={isPrimary ? 'ghost' : variant}
      {...props}
    />
  );
}
