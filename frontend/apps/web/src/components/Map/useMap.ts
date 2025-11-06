import { useEffect, useMemo, useState } from 'react';

import { createHookContext } from '@ci/common';
import L, { type LatLngExpression } from 'leaflet';
import { useMap as useLeafletMap } from 'react-leaflet';

type ReturnType = [
  {
    locations: LatLngExpression[];
  },
];

function useMap(): ReturnType {
  const map = useLeafletMap();

  const [markers, setMarkers] = useState<L.Marker[]>([]);

  useEffect(() => {
    if (!map) {
      return;
    }

    const initialMarkers: L.Marker[] = [];

    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
        initialMarkers.push(layer);
      }
    });

    setMarkers(initialMarkers);

    const handleAdd = (e: L.LayerEvent) => {
      if (e.layer instanceof L.Marker) {
        setMarkers((prevMarkers) => [...prevMarkers, e.layer as L.Marker]);
      }
    };

    const handleRemove = (e: L.LayerEvent) => {
      if (e.layer instanceof L.Marker) {
        setMarkers((prevMarkers) => prevMarkers.filter((marker) => marker !== e.layer));
      }
    };

    map.on('layeradd', handleAdd);
    map.on('layerremove', handleRemove);

    return () => {
      map.off('layeradd', handleAdd);
      map.off('layerremove', handleRemove);
    };
  }, [map]);

  const markerLocations = useMemo(() => {
    return markers.map((marker) => {
      const latLng = marker.getLatLng();

      return [latLng.lat, latLng.lng] as LatLngExpression;
    });
  }, [markers]);

  return [
    {
      locations: markerLocations,
    },
  ];
}

const { Provider, useHookContext } = createHookContext(useMap);

export { Provider as MapProvider, useHookContext as useMap };
