import { useMemo } from 'react';

import { cn } from '@ci/shadcn';
import { Squircle } from '@ci/shadcn/icons';
import L, { type LeafletMouseEvent } from 'leaflet';
import { renderToString } from 'react-dom/server';
import { Marker as LeafletMarker, type MarkerProps } from 'react-leaflet';

const MARKER_DIAMETER = 48; // Corresponds to h-12, w-12
const POINTER_HEIGHT = 38; // The height of the CSS triangle

type MakeMarkerOpts = {
  bgColor?: string;
  borderColor?: string;
};

export function makeMarkerIcon({ bgColor, borderColor }: MakeMarkerOpts): L.DivIcon {
  const html = renderToString(
    <div className="relative flex flex-col items-center">
      <div
        className={`h-12 w-12 p-1 relative flex items-center justify-center bg-${bgColor} border-4 border-${borderColor} rounded-full`}
      >
        <Squircle className="text-accent" />
      </div>

      <div
        className={cn(
          'w-0 h-0',
          'border-l-transparent border-r-transparent',
          `border-t-${borderColor}`,
          `-mt-[${MARKER_DIAMETER / 2}px]`,
        )}
        style={{
          // These are styles because Tailwind doesn't support dynamic values for border widths
          // and does not generate the required classes since we're using calculated values.
          borderLeftWidth: `${MARKER_DIAMETER / 2}px`,
          borderRightWidth: `${MARKER_DIAMETER / 2}px`,
          borderTopWidth: `${POINTER_HEIGHT}px`,
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

interface Props extends Omit<MarkerProps, 'icon'> {
  bgColor?: string;
  borderColor?: string;
  onClick?: (e: LeafletMouseEvent) => void;
}

export function Marker({ bgColor = 'blue-600', borderColor = 'blue-500', onClick, ...markerProps }: Props) {
  const icon = useMemo(() => makeMarkerIcon({ bgColor, borderColor }), [bgColor, borderColor]);

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
