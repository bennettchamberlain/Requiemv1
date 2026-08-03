import { Form, useFormContext } from '@ci/shadcn';

import comedy from './assets/comedy.png';
import documentary from './assets/documentary.png';
import drama from './assets/drama.png';
import horror from './assets/horror.png';
import { OptionGrid } from './OptionGrid';
import { StepHeader } from './StepHeader';

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
    <div className="space-y-6 w-full">
      <StepHeader title="Would you rather watch?" />
      <Form.Field
        control={form.control}
        name="movie_preference"
        render={({ field }) => <OptionGrid options={options} onValueChange={field.onChange} />}
      />
    </div>
  );
}
