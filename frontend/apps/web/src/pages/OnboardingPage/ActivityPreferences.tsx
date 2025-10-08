import { Form, useFormContext } from '@ci/shadcn';

import arcade from './assets/arcade.jpg';
import bowling from './assets/bowling.jpg';
import hiking from './assets/hiking.jpg';
import skating from './assets/skating.jpg';
import { OptionGrid } from './OptionGrid';

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
    <>
      <div className="text-center text-2xl mb-6 md:mb-10">Would you rather go?</div>
      <Form.Field
        control={form.control}
        name="activity_preference"
        render={({ field }) => <OptionGrid options={options} onValueChange={field.onChange} />}
      />
    </>
  );
}
