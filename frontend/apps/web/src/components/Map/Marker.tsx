import { useMemo } from 'react';

import { Squircle } from '@ci/shadcn/icons';
import L from 'leaflet';
import { renderToString } from 'react-dom/server';
import { Marker, type MarkerProps } from 'react-leaflet';

export function makeMarkerIcon(): L.DivIcon {
  const html = renderToString(
    <div className="h-8 w-8 p-1 relative flex items-center justify-center bg-blue-600 border-2 border-blue-500 rounded-full">
      <Squircle className="text-accent" />
    </div>,
  );

  return L.divIcon({
    className: 'custom-marker',
    html,
    iconSize: [32, 32], // Explicitly set the size (h-8 w-8 -> 32px)
    iconAnchor: [16, 16], // Anchor to the center of the icon
    popupAnchor: [0, -16], // Position popup just above the center
  });
}

type Props = Omit<MarkerProps, 'icon'>;

export default function MyMarker({ ...markerProps }: Props) {
  const icon = useMemo(() => makeMarkerIcon(), []);

  return <Marker zIndexOffset={400} {...markerProps} icon={icon} />;
}
