import { Form, useFormContext } from '@ci/shadcn';

import burger from './assets/burger.png';
import pasta from './assets/pasta.png';
import salad from './assets/salad.png';
import tacos from './assets/tacos.png';
import { OptionGrid } from './OptionGrid';
import { StepHeader } from './StepHeader';

const options = [
  {
    id: 'Pasta',
    title: 'Pasta',
    imageUrl: pasta,
  },
  {
    id: 'Burgers',
    title: 'Burgers',
    imageUrl: burger,
  },
  {
    id: 'Salad',
    title: 'Salad',
    imageUrl: salad,
  },
  {
    id: 'Tacos',
    title: 'Tacos',
    imageUrl: tacos,
  },
];

export function FoodPreferences() {
  const form = useFormContext();

  return (
    <div className="space-y-6 w-full">
      <StepHeader title="Would you rather eat?" />
      <Form.Field
        control={form.control}
        name="food_preference"
        render={({ field }) => <OptionGrid options={options} onValueChange={field.onChange} />}
      />
    </div>
  );
}
