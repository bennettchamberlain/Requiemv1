import { Form, Input, useFormContext } from '@ci/shadcn';

import { StepHeader } from './StepHeader';

export function IdentityStep() {
  const form = useFormContext<{ name?: string | null }>();

  return (
    <div className="space-y-8 w-full max-w-xl mx-auto">
      <StepHeader
        title="What should we call you?"
        description="Let's get your companion set up — every step is skippable."
      />

      {/* TODO(settings): expose name edit in Settings → Profile once that section exists. */}
      <Form.Field
        control={form.control}
        name="name"
        render={({ field }) => (
          <Form.Item className="text-left">
            <Form.Label className="text-base sm:text-lg">Your name</Form.Label>
            <Form.Control>
              <Input
                placeholder="Your name"
                className="h-14 text-xl sm:text-2xl px-4"
                autoFocus
                {...field}
                value={field.value ?? ''}
              />
            </Form.Control>
          </Form.Item>
        )}
      />
    </div>
  );
}
