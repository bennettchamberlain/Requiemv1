import arcade from './assets/arcade.jpg';
import bowling from './assets/bowling.jpg';
import hiking from './assets/hiking.jpg';
import skating from './assets/skating.jpg';
import { OptionGrid } from './OptionGrid';

const options = [
  {
    id: 'hiking',
    title: 'Hiking',
    imageUrl: hiking,
  },
  {
    id: 'bowling',
    title: 'Bowling',
    imageUrl: bowling,
  },
  {
    id: 'skating',
    title: 'Skating',
    imageUrl: skating,
  },
  {
    id: 'arcade',
    title: 'Arcade',
    imageUrl: arcade,
  },
];

export function ActivityPreferences() {
  return <OptionGrid options={options} />;
}
