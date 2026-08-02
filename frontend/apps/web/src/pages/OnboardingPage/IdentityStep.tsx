import { Form, Input, useFormContext } from '@ci/shadcn';

export function IdentityStep() {
  const form = useFormContext<{ name?: string | null }>();

  return (
    <div className="space-y-6 py-6 w-full max-w-md mx-auto">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Welcome</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Let&apos;s get your companion set up — every step is skippable.
        </p>
      </div>

      {/* TODO(settings): expose name edit in Settings → Profile once that section exists. */}
      <Form.Field
        control={form.control}
        name="name"
        render={({ field }) => (
          <Form.Item>
            <Form.Label>Your name</Form.Label>
            <Form.Control>
              <Input placeholder="Your name" {...field} value={field.value ?? ''} />
            </Form.Control>
          </Form.Item>
        )}
      />
    </div>
  );
}
