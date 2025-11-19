import { Form, useFormContext } from '@ci/shadcn';

import comedy from './assets/comedy.png';
import documentary from './assets/documentary.png';
import drama from './assets/drama.png';
import horror from './assets/horror.png';
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
    imageUrl: documentary,
  },
  {
    id: 'Comedies',
    title: 'Comedies',
    imageUrl: comedy,
  },
  {
    id: 'Horror',
    title: 'Horror',
    imageUrl: horror,
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
