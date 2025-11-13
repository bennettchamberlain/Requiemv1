import { useMemo } from 'react';

import { cn } from '@ci/shadcn';
import { Squircle } from '@ci/shadcn/icons';
import L, { type LeafletMouseEvent } from 'leaflet';
import { renderToString } from 'react-dom/server';
import { Marker as LeafletMarker, type MarkerProps } from 'react-leaflet';

const MARKER_DIAMETER = 48; // Corresponds to h-12, w-12
const POINTER_HEIGHT = 38; // The height of the CSS triangle

type MarkerVariant = 'blue' | 'red' | 'green' | 'default';

const COLOR_MAP: Record<MarkerVariant, { bg: string; border: string; pointer: string; text: string }> = {
  default: {
    bg: 'bg-blue-600',
    border: 'border-blue-500',
    pointer: 'border-t-blue-500',
    text: 'text-white',
  },
  blue: {
    bg: 'bg-blue-600',
    border: 'border-blue-500',
    pointer: 'border-t-blue-500',
    text: 'text-white',
  },
  red: {
    bg: 'bg-red-600',
    border: 'border-red-500',
    pointer: 'border-t-red-500',
    text: 'text-white',
  },
  green: {
    bg: 'bg-green-600',
    border: 'border-green-500',
    pointer: 'border-t-green-500',
    text: 'text-white',
  },
};

interface Props extends Omit<MarkerProps, 'icon'> {
  variant?: MarkerVariant;
  onClick?: (e: LeafletMouseEvent) => void;
}

export function Marker({ variant = 'default', onClick, ...markerProps }: Props) {
  const icon = useMemo(() => makeMarkerIcon({ variant }), [variant]);

  const eventHandlers = useMemo(
    () => ({
      click: (e: LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        onClick?.(e);
      },
      dblclick: (e: LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
      },
    }),
    [onClick],
  );

  return <LeafletMarker zIndexOffset={400} {...markerProps} icon={icon} eventHandlers={eventHandlers} />;
}

type MakeMarkerOpts = {
  variant?: MarkerVariant;
};

function makeMarkerIcon({ variant = 'default' }: MakeMarkerOpts): L.DivIcon {
  const colors = COLOR_MAP[variant];

  const html = renderToString(
    <div className="relative flex flex-col items-center">
      <div
        className={cn(
          'h-12 w-12 p-1 relative flex items-center justify-center rounded-full border-4',
          colors.bg,
          colors.border,
        )}
      >
        <Squircle className={cn(colors.text)} />
      </div>

      <div
        className={cn('w-0 h-0', 'border-l-transparent border-r-transparent', colors.pointer)}
        style={{
          // These are styles because Tailwind doesn't support dynamic values for border widths
          // and does not generate the required classes since we're using calculated values.
          borderLeftWidth: `${MARKER_DIAMETER / 2}px`,
          borderRightWidth: `${MARKER_DIAMETER / 2}px`,
          borderTopWidth: `${POINTER_HEIGHT}px`,
          marginTop: `-${MARKER_DIAMETER / 2}px`,
        }}
      />
    </div>,
  );

  const totalHeight = MARKER_DIAMETER / 2 + POINTER_HEIGHT;

  return L.divIcon({
    className: 'custom-marker', // This class should have no default Leaflet background/border
    html,
    // The total dimensions of the new marker element (circle + pointer)
    iconSize: [MARKER_DIAMETER, totalHeight],
    // Anchor to the tip of the pointer: center horizontally, bottom vertically
    iconAnchor: [MARKER_DIAMETER / 2, totalHeight],
    // Position the popup to open directly above the marker's anchor point
    popupAnchor: [0, -totalHeight],
  });
}
