import { Form, useFormContext } from '@ci/shadcn';

import burger from './assets/burger.jpg';
import pasta from './assets/pasta.jpg';
import salad from './assets/salad.jpg';
import tacos from './assets/tacos.jpg';
import { OptionGrid } from './OptionGrid';

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
    <>
      <div className="text-center text-2xl mb-6 md:mb-10">Would you rather eat?</div>
      <Form.Field
        control={form.control}
        name="food_preference"
        render={({ field }) => <OptionGrid options={options} onValueChange={field.onChange} />}
      />
    </>
  );
}
