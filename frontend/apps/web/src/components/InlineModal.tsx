import { type ReactNode, useEffect } from 'react';

interface Props {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
}

export function InlineModal({ open, onClose, children }: Props) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="absolute flex flex-col inset-0 z-10 bg-background animate-in fade-in-0">{children}</div>
  );
}
