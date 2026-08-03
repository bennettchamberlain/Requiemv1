import { Form, useFormContext } from '@ci/shadcn';

import arcade from './assets/arcade.png';
import bowling from './assets/bowling.png';
import hiking from './assets/hiking.png';
import skating from './assets/skating.png';
import { OptionGrid } from './OptionGrid';
import { StepHeader } from './StepHeader';

const options = [
  {
    id: 'Hiking',
    title: 'Hiking',
    imageUrl: hiking,
  },
  {
    id: 'Bowling',
    title: 'Bowling',
    imageUrl: bowling,
  },
  {
    id: 'Skating',
    title: 'Skating',
    imageUrl: skating,
  },
  {
    id: 'Arcading',
    title: 'Arcading',
    imageUrl: arcade,
  },
];

export function ActivityPreferences() {
  const form = useFormContext();

  return (
    <div className="space-y-6 w-full">
      <StepHeader title="Would you rather go?" />
      <Form.Field
        control={form.control}
        name="activity_preference"
        render={({ field }) => <OptionGrid options={options} onValueChange={field.onChange} />}
      />
    </div>
  );
}
