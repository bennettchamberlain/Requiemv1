import { Checkbox, Form, cn, useFormContext } from '@ci/shadcn';

import { StepHeader } from './StepHeader';

const focusAreaOptions = [
  {
    id: 'personal_fitness',
    label: 'Personal fitness and health',
    description:
      'Track workouts, monitor progress, and build habits that support long-term physical wellbeing',
  },
  {
    id: 'nutrition',
    label: 'Nutrition and meal planning',
    description: 'Plan meals, organize grocery lists, and align food choices with your health goals',
  },
  {
    id: 'communication',
    label: 'Communication management',
    description: 'Centralize messages, schedule conversations, and keep track of important interactions',
  },
  {
    id: 'entertainment',
    label: 'Entertainment and activities',
    description: 'Organize hobbies, events, and downtime to bring balance and enjoyment to your schedule',
  },
  {
    id: 'travel',
    label: 'Travel planning',
    description: 'Manage itineraries, bookings, and logistics to make trips easier from start to finish',
  },
];

export function FocusAreas() {
  const form = useFormContext();

  return (
    <div className="space-y-6 w-full max-w-xl mx-auto text-left">
      <StepHeader title="What should we focus on?" description="Pick anything that matters right now." />
      <div className="space-y-3">
        {focusAreaOptions.map((item) => (
          <Form.Field
            key={item.id}
            control={form.control}
            name="focus_areas"
            render={({ field }) => {
              const checked = field.value?.includes(item.id) ?? false;
              const checkboxId = `focus-area-${item.id}`;

              const toggle = () => {
                field.onChange(
                  checked
                    ? field.value?.filter((value: string) => value !== item.id)
                    : [...(field.value || []), item.id],
                );
              };

              return (
                <Form.Item
                  key={item.id}
                  className={cn(
                    'grid grid-cols-[max-content_1fr] items-start gap-x-4 rounded-xl border border-border/70 bg-muted/40 px-4 py-3.5 transition-colors cursor-pointer hover:bg-muted/55',
                    checked && 'border-primary/40 bg-muted/60',
                  )}
                  onClick={toggle}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggle();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <Form.Control>
                    <Checkbox
                      id={checkboxId}
                      className="mt-1 size-5 border-border bg-background"
                      checked={checked}
                      onCheckedChange={(value) => {
                        field.onChange(
                          value
                            ? [...(field.value || []), item.id]
                            : field.value?.filter((entry: string) => entry !== item.id),
                        );
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </Form.Control>

                  <div className="space-y-1 pointer-events-none">
                    <Form.Label htmlFor={checkboxId} className="text-lg sm:text-xl font-medium leading-snug">
                      {item.label}
                    </Form.Label>
                    <Form.Description className="text-base text-muted-foreground leading-snug">
                      {item.description}
                    </Form.Description>
                  </div>
                </Form.Item>
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}
