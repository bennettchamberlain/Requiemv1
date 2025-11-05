import type { ComponentProps } from 'react';

import { Button } from '@ci/shadcn';
import type { Meta, StoryObj } from '@storybook/react';
import { type LatLngExpression } from 'leaflet';
import { Marker, Popup } from 'react-leaflet';

import { Map } from './Map';

const SAN_FRANCISCO: LatLngExpression = [37.7749, -122.4194];

type Props = ComponentProps<typeof Map>;

const meta: Meta<Props> = {
  component: Map,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    center: SAN_FRANCISCO,
  },
  decorators: [
    (Story) => (
      <div className="w-full h-screen">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<Props>;

export const Default: Story = {};

export const WithMarker: Story = {
  args: {
    children: (
      <Marker position={SAN_FRANCISCO}>
        <Popup>Hello from Leaflet 👋</Popup>
      </Marker>
    ),
  },
};

export const WithPanel: Story = {
  args: {
    children: (
      <Map.Panel className="bg-white/50 p-4 space-y-4">
        <div>Some informative text in the panel.</div>
        <Button className="w-full">Action 1</Button>
      </Map.Panel>
    ),
  },
};

export const WithControls: Story = {
  args: {
    children: <Map.Controls position="top-left" />,
  },
};
