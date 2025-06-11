import type { ButtonHTMLAttributes } from 'react';

import './button.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  primary?: boolean;
  backgroundColor?: string;
  size?: string;
}

export function Button({ label, primary = false, backgroundColor, size = 'medium', ...props }: Props) {
  const mode = primary ? 'storybook-button--primary' : 'storybook-button--secondary';

  return (
    <button
      type="button"
      className={['storybook-button', `storybook-button--${size}`, mode].join(' ')}
      style={backgroundColor ? { backgroundColor } : undefined}
      {...props}
    >
      {label}
    </button>
  );
}
