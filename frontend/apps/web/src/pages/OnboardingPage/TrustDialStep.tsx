import { cn } from '@ci/shadcn';

import type { OnboardingFormData } from './OnboardingPage';

const TRUST_OPTIONS = [
  { value: 'cautious' as const, label: 'Cautious', hint: 'Review everything yourself' },
  { value: 'balanced' as const, label: 'Balanced', hint: 'High-confidence items auto-promote' },
  {
    value: 'hands_off' as const,
    label: 'Hands-off',
    hint: 'Auto-promote and auto-schedule estimate-bearing work',
  },
];

interface TrustDialStepProps {
  value: OnboardingFormData['trust_mode'];
  onChange: (value: NonNullable<OnboardingFormData['trust_mode']>) => void;
}

export function TrustDialStep({ value, onChange }: TrustDialStepProps) {
  const selected = value ?? 'balanced';

  return (
    <div className="space-y-6 py-6 w-full max-w-md mx-auto">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Trust dial</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          How much should your companion do on its own?
        </p>
      </div>

      {/* TODO(settings): Autonomy subsection — same dial, reads/writes self-entity properties.planner.trust_mode */}
      <div className="flex flex-col gap-2">
        {TRUST_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={cn(
              'rounded-lg border border-border px-4 py-3 text-left transition-colors',
              selected === opt.value && 'border-teal-600 bg-teal-500/10',
            )}
            onClick={() => onChange(opt.value)}
          >
            <span className="block text-sm font-medium text-foreground">{opt.label}</span>
            <span className="block text-xs text-muted-foreground">{opt.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
