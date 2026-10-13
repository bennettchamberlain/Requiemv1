import { type ReactNode } from 'react';

import { type LatLngExpression } from 'leaflet';
import { MapContainer, TileLayer } from 'react-leaflet';

import 'leaflet/dist/leaflet.css';

import { Controls } from './Controls';
import { Marker } from './Marker';
import { Panel } from './Panel';
import { RouteLayer } from './RouteLayer';
import { MapProvider } from './useMap';

interface Props {
  center?: LatLngExpression;
  children?: ReactNode;
  zoom?: number;
  zoomEnabled?: boolean;
  draggingEnabled?: boolean;
  attributionControl?: boolean;
  autoCenterMarkers?: boolean;
}

export const MAP_IMAGERY_ATTRIBUTION =
  'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export function Map({
  center,
  children,
  zoom = 13,
  zoomEnabled = true,
  draggingEnabled = true,
  attributionControl = true,
  autoCenterMarkers = true,
}: Props) {
  return (
    <div
      data-testid="map-root"
      className="relative h-full w-full [&_.leaflet-control-attribution]:opacity-[0.65] [&_.leaflet-control-attribution]:transition-opacity [&_.leaflet-control-attribution:focus-within]:opacity-100 [&_.leaflet-control-attribution:hover]:opacity-100"
      style={{ zIndex: 1 }}
    >
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }} // map must have size
        scrollWheelZoom={zoomEnabled}
        dragging={draggingEnabled}
        zoomControl={false}
        attributionControl={attributionControl}
      >
        <MapProvider args={[{ autoCenterMarkers }]}>
          {/* The basemap belongs to a third party, and rendering it contacts them on every
              tile — the one egress a fresh appliance performs with no key and no connector.
              Esri's World Imagery terms require the credit, and the attribution control is
              the only place the UI would name them, so it stays on. The product video's
              memory-map shot masked this selector for a while; it was masking an element
              that had been switched off here. See docs/architecture/third-party-egress.md. */}
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution={MAP_IMAGERY_ATTRIBUTION}
          />

          {children}
        </MapProvider>
      </MapContainer>
    </div>
  );
}

Map.Controls = Controls;
Map.Marker = Marker;
Map.Panel = Panel;
Map.RouteLayer = RouteLayer;
