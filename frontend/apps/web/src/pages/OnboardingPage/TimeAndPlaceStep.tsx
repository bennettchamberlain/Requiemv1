import { Form, Input, useFormContext } from '@ci/shadcn';

import { BROWSER_TIMEZONE } from './constants';
import { StepHeader } from './StepHeader';

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
    <div className="space-y-7 w-full max-w-xl mx-auto text-left">
      <StepHeader
        title="Time and place"
        description={
          <>
            Plan your time intentionally. Detected timezone:{' '}
            <span className="text-foreground font-medium">{BROWSER_TIMEZONE}</span>
          </>
        }
      />

      {/* TODO(settings): Schedule subsection under Preferences — wake/sleep/work hours from self-entity properties.schedule */}
      <div className="grid grid-cols-2 gap-4 sm:gap-5">
        <Form.Field
          control={form.control}
          name="schedule.wake_time"
          render={({ field }) => (
            <Form.Item>
              <Form.Label className="text-base">Usually wake up</Form.Label>
              <Form.Control>
                <Input type="time" className="h-12 text-lg" {...field} value={field.value ?? '07:00'} />
              </Form.Control>
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="schedule.sleep_time"
          render={({ field }) => (
            <Form.Item>
              <Form.Label className="text-base">Usually go to bed</Form.Label>
              <Form.Control>
                <Input type="time" className="h-12 text-lg" {...field} value={field.value ?? '21:00'} />
              </Form.Control>
            </Form.Item>
          )}
        />
      </div>

      <p className="text-base text-muted-foreground leading-snug">
        Your companion uses these hours to understand your rhythm. Change them any time in Settings.
      </p>

      <div className="grid grid-cols-2 gap-4 sm:gap-5">
        <Form.Field
          control={form.control}
          name="schedule.work_start"
          render={({ field }) => (
            <Form.Item>
              <Form.Label className="text-base">Workday start</Form.Label>
              <Form.Control>
                <Input type="time" className="h-12 text-lg" {...field} value={field.value ?? '09:00'} />
              </Form.Control>
            </Form.Item>
          )}
        />
        <Form.Field
          control={form.control}
          name="schedule.work_end"
          render={({ field }) => (
            <Form.Item>
              <Form.Label className="text-base">Workday end</Form.Label>
              <Form.Control>
                <Input type="time" className="h-12 text-lg" {...field} value={field.value ?? '18:00'} />
              </Form.Control>
            </Form.Item>
          )}
        />
      </div>
    </div>
  );
}
