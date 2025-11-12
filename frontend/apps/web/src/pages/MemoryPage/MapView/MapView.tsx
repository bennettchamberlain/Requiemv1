import { useMemo } from 'react';

import { Map } from '@/components/Map';

import { TimelineView } from '../TimelineView';
import { useMemoryService } from '../useMemoryService';


export function DesktopMapView() {
  const { memories, setActiveMemory } = useMemoryService();

  const memoriesWithLocation = useMemo(() => {
    const filteredMemories = memories.filter(
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
  }, [memories]);

  return (
    // TODO: This default leads to some map jittering. It's OK for now, but let's think about tracking the user's last location and use that for the default center.
    <Map center={[37.7749, -122.4194]}>
      <Map.Controls position="bottom-right" />
      <Map.Panel position="left" className="w-[300px] relative">
        <TimelineView />
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
