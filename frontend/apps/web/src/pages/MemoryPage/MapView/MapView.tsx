import { useMemo } from 'react';

import { Map } from '@/components/Map';
import { useEntityService } from '@/pages/MemoryPage/useEntityService.tsx';

import { TimelineView } from '../TimelineView';

export function DesktopMapView() {
  const [{ data }, { setActiveEntity }] = useEntityService();
  console.log('data in MapView', data);

  const memoriesWithLocation = useMemo(() => {
    const filteredMemories = data.filter(
      (memory) =>
        memory.location &&
        typeof memory.location.properties.latitude === 'number' &&
        typeof memory.location.properties.longitude === 'number' &&
        !isNaN(memory.location.properties.latitude) &&
        !isNaN(memory.location.properties.longitude) &&
        !(memory.location.properties.latitude === 0 && memory.location.properties.longitude === 0),
    );

    filteredMemories.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return filteredMemories;
  }, [data]);

  return (
    // TODO: This default leads to some map jittering. It's OK for now, but let's think about tracking the user's last location and use that for the default center.
    <Map center={[37.7749, -122.4194]}>
      <Map.Controls position="bottom-right" />
      <Map.Panel position="left" className="w-[300px] relative">
        <TimelineView />
        <SoftBlur />
      </Map.Panel>

      <Map.RouteLayer />
      {memoriesWithLocation.map((memory) => (
        <Map.Marker
          key={memory.id}
          position={[memory.location!.properties!.latitude, memory.location!.properties!.longitude]}
          onClick={() => setActiveEntity(memory)}
        />
      ))}
    </Map>
  );
}

export function MobileMapView() {
  return null;
}

function SoftBlur({ className = '' }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 backdrop-blur-xl -z-1 ${className}`}
      style={{
        WebkitMaskImage: 'linear-gradient(to right, black 70%, transparent)',
        maskImage: 'linear-gradient(to right, black 70%, transparent)',
      }}
    />
  );
}
