import { useMemo } from 'react';

import { useSearchParams } from 'react-router-dom';

import { Map } from '@/components/Map';
import { useMemoryServiceNext } from '@/pages/MemoryPage/useMemoryServiceNext.tsx';

import { TimelineView } from '../TimelineView';

export function DesktopMapView() {
  const [searchParams] = useSearchParams();
  const { data } = useMemoryServiceNext({
    searchQuery: searchParams.get('search') || '',
    excludeTypes: searchParams.get('excludedEntityTypes')?.split(',') || [],
  });

  const memoriesWithLocation = useMemo(() => {
    const filteredMemories = data.filter(
      (memory) =>
        memory.location &&
        typeof memory.location.lat === 'number' &&
        typeof memory.location.lng === 'number' &&
        !isNaN(memory.location.lat) &&
        !isNaN(memory.location.lng) &&
        !(memory.location.lat === 0 && memory.location.lng === 0),
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
          position={[memory.location!.lat, memory.location!.lng]}
          onClick={() => setActiveMemory(memory)}
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
