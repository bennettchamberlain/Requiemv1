import clown from './assets/clown.jpg';
import drama from './assets/drama.jpg';
import nature from './assets/nature.jpg';
import zombie from './assets/zombie.jpg';
import { OptionGrid } from './OptionGrid';

const options = [
  {
    id: 'horror',
    title: 'Horror',
    imageUrl: zombie,
  },
  {
    id: 'drama',
    title: 'Drama',
    imageUrl: drama,
  },
  {
    id: 'comedy',
    title: 'Comedy',
    imageUrl: clown,
  },
  {
    id: 'documentary',
    title: 'Documentary',
    imageUrl: nature,
  },
];

export function MoviePreferences() {
  return <OptionGrid options={options} />;
}
