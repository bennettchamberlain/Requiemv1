import { type ReactNode } from 'react';

import { type LatLngExpression } from 'leaflet';
import { MapContainer, TileLayer } from 'react-leaflet';

import 'leaflet/dist/leaflet.css';

import { Controls } from './Controls';
import { Panel } from './Panel';

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
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />

        {children}
      </MapContainer>
    </div>
  );
}

Map.Controls = Controls;
Map.Panel = Panel;
