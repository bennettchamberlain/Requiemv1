import type { ComponentProps } from 'react';

import { Card } from '@ci/shadcn';
import type { Meta, StoryObj } from '@storybook/react';
import { type LatLngExpression } from 'leaflet';
import { action } from 'storybook/actions';

import { Map } from './Map';

const TRANSAMERICA_PYRAMID: LatLngExpression = [37.7952, -122.4028];
const GOLDEN_GATE_BRIDGE: LatLngExpression = [37.806409919782666, -122.47585786589606];
const GOLDEN_GATE_PARK: LatLngExpression = [37.77022987046795, -122.4856038608843];
const NOE_PEAK: LatLngExpression = [37.7516, -122.4477];
const CIVIC_CENTER: LatLngExpression = [37.7793, -122.4192];

type Props = ComponentProps<typeof Map>;

const meta: Meta<Props> = {
  component: Map,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    center: [37.791302364205926, -122.43236422384159],
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

const onMarkerClick = action('onClick');

export const Default: Story = {
  args: {
    children: (
      <>
        <Map.Marker
          position={TRANSAMERICA_PYRAMID}
          onClick={(...args: unknown[]) => onMarkerClick(...args)}
        />
        <Map.Marker position={CIVIC_CENTER} onClick={(...args: unknown[]) => onMarkerClick(...args)} />
        <Map.Marker position={NOE_PEAK} onClick={(...args: unknown[]) => onMarkerClick(...args)} />
        <Map.Marker position={GOLDEN_GATE_PARK} onClick={(...args: unknown[]) => onMarkerClick(...args)} />
        <Map.Marker position={GOLDEN_GATE_BRIDGE} onClick={(...args: unknown[]) => onMarkerClick(...args)} />

        <Map.RouteLayer />

        <Map.Controls position="top-left" />

        <Map.Panel>
          <div className="space-y-4 p-4">
            <Card className="p-2 border-4 bg-secondary">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Cras auctor, magna a mattis gravida,
              ipsum mauris malesuada nunc, in lacinia ante eros sed lectus. Integer convallis eros non urna
              iaculis, ut tincidunt arcu ultricies. Nulla at fermentum mauris, nec interdum augue.
              Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.
            </Card>

            <Card className="p-2 border-4 bg-secondary">
              Praesent placerat ligula at orci consequat, vitae varius odio malesuada. Fusce cursus risus et
              mollis suscipit. Sed congue tortor non magna scelerisque, vitae egestas magna malesuada. Morbi
              sed nunc at felis pharetra consequat. Ut vitae euismod magna. Sed elementum risus vitae dolor
              convallis tempus.
            </Card>

            <Card className="p-2 border-4 bg-secondary">
              Pellentesque tempus, nisl id suscipit varius, felis lorem bibendum lacus, at efficitur lectus
              lorem eget arcu. Suspendisse mattis mi sed enim vestibulum volutpat. Nulla facilisi. Integer ut
              ante id leo lobortis sodales. Cras interdum mauris massa, at auctor lorem volutpat ac.
            </Card>

            <Card className="p-2 border-4 bg-secondary">
              Sed dapibus, leo a fringilla sodales, velit dui scelerisque erat, sit amet convallis purus dui
              et massa. Duis posuere feugiat mi, in gravida neque. Cras mollis feugiat sapien, eget sodales
              urna laoreet non. Curabitur ut lectus purus. In id nisi quis est aliquet viverra at nec ante.
            </Card>

            <Card className="p-2 border-4 bg-secondary">
              Integer a orci id dolor fermentum suscipit non vitae nunc. Quisque quis vestibulum est. Aenean
              vestibulum, dolor vel faucibus malesuada, lorem nisl dapibus est, a gravida est odio sit amet
              turpis. Nulla facilisi. Vestibulum a erat viverra, bibendum risus vel, interdum purus.
            </Card>

            <Card className="p-2 border-4 bg-secondary">
              Aliquam bibendum metus id odio commodo, nec congue ligula porta. Morbi dignissim suscipit
              fermentum. Donec vitae orci vitae libero gravida dictum ut vitae augue. Suspendisse potenti. Sed
              non est turpis. Donec interdum, orci non sodales posuere, turpis nulla dictum erat, vitae porta
              nisi lorem vel lectus.
            </Card>

            <Card className="p-2 border-4 bg-secondary">
              Aenean sagittis, mauris vitae cursus efficitur, nulla mauris pulvinar neque, nec volutpat lacus
              arcu nec mauris. Etiam ultrices scelerisque lorem, nec hendrerit urna luctus at. Donec
              scelerisque convallis lacus, a tincidunt neque lacinia id. Sed accumsan justo vel odio cursus
              tincidunt.
            </Card>

            <Card className="p-2 border-4 bg-secondary">
              Ut tincidunt nisl nec ligula auctor semper. Nam convallis pellentesque diam ut faucibus. Nullam
              eget erat at nulla lobortis efficitur. Vestibulum rutrum, justo vitae sodales semper, risus
              purus aliquet risus, id maximus augue felis at turpis. Curabitur a leo ut tortor cursus
              tristique.
            </Card>

            <Card className="p-2 border-4 bg-secondary">
              Etiam eu risus vel elit lacinia elementum. Suspendisse gravida non odio a sollicitudin. Mauris
              et eros a mauris scelerisque dictum at at lorem. Donec auctor purus velit, non varius arcu
              consectetur nec. Sed cursus, enim eget volutpat sollicitudin, urna nisl rhoncus risus, ut
              pulvinar nisl odio ac elit.
            </Card>

            <Card className="p-2 border-4 bg-secondary">
              Vivamus vitae felis a odio tristique eleifend eget at magna. Phasellus dignissim sem sed urna
              condimentum, vitae dapibus sem luctus. Duis sit amet accumsan sapien. Nulla at libero in mi
              luctus accumsan non ac justo. Curabitur varius augue id lacinia convallis.
            </Card>
          </div>
        </Map.Panel>
      </>
    ),
  },
};
