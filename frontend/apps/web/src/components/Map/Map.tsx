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
}

export function Map({ center, children }: Props) {
  return (
    <div className="relative w-full h-full" style={{ zIndex: 1 }}>
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%' }} // map must have size
        scrollWheelZoom={true}
        attributionControl={false}
        zoomControl={false}
      >
        <MapProvider args={[]}>
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />

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
