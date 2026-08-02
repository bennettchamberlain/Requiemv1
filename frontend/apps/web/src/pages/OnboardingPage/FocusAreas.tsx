import { Checkbox, Form, useFormContext } from '@ci/shadcn';

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
    <div className="space-y-4 py-2 md:py-4 w-full max-w-md mx-auto text-left">
      <h1 className="text-2xl text-center font-semibold text-foreground">Your focus areas</h1>
      <div className="space-y-5">
        {focusAreaOptions.map((item) => (
          <Form.Field
            key={item.id}
            control={form.control}
            name="focus_areas"
            render={({ field }) => {
              return (
                <Form.Item key={item.id} className="grid grid-cols-[max-content_1fr] items-center gap-x-3">
                  <Form.Control>
                    <Checkbox
                      onCheckedChange={(checked) => {
                        return checked
                          ? field.onChange([...(field.value || []), item.id])
                          : field.onChange(field.value?.filter((value: string) => value !== item.id));
                      }}
                    />
                  </Form.Control>

                  <Form.Label className="font-medium cursor-pointer">{item.label}</Form.Label>
                  <Form.Description className="col-start-2 text-muted-foreground">
                    {item.description}
                  </Form.Description>
                </Form.Item>
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}
