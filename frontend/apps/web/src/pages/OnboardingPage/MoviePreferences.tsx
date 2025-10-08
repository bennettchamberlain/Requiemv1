import { Form, useFormContext } from '@ci/shadcn';

import clown from './assets/clown.jpg';
import drama from './assets/drama.jpg';
import nature from './assets/nature.jpg';
import zombie from './assets/zombie.jpg';
import { OptionGrid } from './OptionGrid';

const options = [
  {
    id: 'Dramas',
    title: 'Dramas',
    imageUrl: drama,
  },
  {
    id: 'Documentaries',
    title: 'Documentaries',
    imageUrl: nature,
  },
  {
    id: 'Comedies',
    title: 'Comedies',
    imageUrl: clown,
  },
  {
    id: 'Horror',
    title: 'Horror',
    imageUrl: zombie,
  },
];

export function MoviePreferences() {
  const form = useFormContext();

  return (
    <>
      <div className="text-center text-2xl mb-6 md:mb-10">Would you rather watch?</div>
      <Form.Field
        control={form.control}
        name="movie_preference"
        render={({ field }) => <OptionGrid options={options} onValueChange={field.onChange} />}
      />
    </>
  );
}
