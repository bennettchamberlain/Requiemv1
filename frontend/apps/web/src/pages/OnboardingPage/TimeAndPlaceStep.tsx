import { Form, Input, useFormContext } from '@ci/shadcn';

import { BROWSER_TIMEZONE } from './constants';

export function TimeAndPlaceStep() {
  const form = useFormContext<{
    schedule?: {
      wake_time?: string;
      sleep_time?: string;
      work_start?: string;
      work_end?: string;
    } | null;
  }>();

  return (
    <div className="space-y-6 py-6 w-full max-w-md mx-auto text-left">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Time and place</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Block your days intelligently. Detected timezone:{' '}
          <span className="text-foreground">{BROWSER_TIMEZONE}</span>
        </p>
      </div>

      {/* TODO(settings): Schedule subsection under Preferences — wake/sleep/work hours from self-entity properties.schedule */}
      <div className="grid grid-cols-2 gap-4">
        <Form.Field
          control={form.control}
          name="schedule.wake_time"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Usually wake up</Form.Label>
              <Form.Control>
                <Input type="time" {...field} value={field.value ?? '07:00'} />
              </Form.Control>
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="schedule.sleep_time"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Usually go to bed</Form.Label>
              <Form.Control>
                <Input type="time" {...field} value={field.value ?? '21:00'} />
              </Form.Control>
            </Form.Item>
          )}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Your companion uses these hours to understand your rhythm. Change them any time in Settings.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Form.Field
          control={form.control}
          name="schedule.work_start"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Workday start</Form.Label>
              <Form.Control>
                <Input type="time" {...field} value={field.value ?? '09:00'} />
              </Form.Control>
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="schedule.work_end"
          render={({ field }) => (
            <Form.Item>
              <Form.Label>Workday end</Form.Label>
              <Form.Control>
                <Input type="time" {...field} value={field.value ?? '18:00'} />
              </Form.Control>
            </Form.Item>
          )}
        />
      </div>
    </div>
  );
}
