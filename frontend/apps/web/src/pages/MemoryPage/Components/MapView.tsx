/// <reference types="google.maps" />
import { useEffect, useRef, useMemo, useCallback, useState } from 'react';

import 'leaflet/dist/leaflet.css';
import { Route } from '@ci/shadcn/icons';
import L from 'leaflet';

import { loadGoogleMaps } from '../googleMaps';
import { useMemoryTimeline } from '../MemoryProvider';

import { MemoryTimeline } from './MemoryTimeline';

// Google Maps API types
declare global {
  interface Window {
    google: typeof google;
  }
}

interface MapViewProps {
  showTimeline?: boolean;
  className?: string;
}

export function MapView({ showTimeline = false, className = '' }: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const polylinesRef = useRef<L.Polyline[]>([]);
  const { memories } = useMemoryTimeline();

  // Memoize memories with valid locations to prevent unnecessary recalculations
  const memoriesWithLocation = useMemo(() => {
    return memories.filter(
      (memory) =>
        memory.location &&
        typeof memory.location.lat === 'number' &&
        typeof memory.location.lng === 'number' &&
        !isNaN(memory.location.lat) &&
        !isNaN(memory.location.lng) &&
        !(memory.location.lat === 0 && memory.location.lng === 0),
    );
  }, [memories]);

  // Function to wait for Google Maps to load
  const waitForGoogleMaps = (): Promise<void> => {
    return loadGoogleMaps();
  };

  // Function to clear existing markers and polylines
  const clearMapElements = useCallback(() => {
    if (mapRef.current) {
      // Clear existing markers
      markersRef.current.forEach((marker) => {
        mapRef.current?.removeLayer(marker);
      });
      markersRef.current = [];

      // Clear existing polylines
      polylinesRef.current.forEach((polyline) => {
        mapRef.current?.removeLayer(polyline);
      });
      polylinesRef.current = [];
    }
  }, []);

  // Function to update markers and routes
  const updateMapMarkers = useCallback(async () => {
    if (!mapRef.current || memoriesWithLocation.length === 0) {
      return;
    }

    console.log('MapView: Updating markers with', memoriesWithLocation.length, 'memories');

    // Clear existing markers and polylines
    clearMapElements();

    const primaryColor = 'var(--primary)';
    const destructiveColor = 'var(--destructive)';

    // Create custom icon for markers
    const customIcon = L.divIcon({
      className: 'custom-map-marker',
      html: `<div class="w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-map-pin"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 24],
      popupAnchor: [0, -24],
    });

    // Add markers for memories with location
    const bounds = L.latLngBounds([]);
    const markers: L.Marker[] = [];

    const sortedMemories = [...memoriesWithLocation].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    sortedMemories.forEach((memory) => {
      if (memory.location) {
        const marker = L.marker([memory.location.lat, memory.location.lng], { icon: customIcon })
          .addTo(mapRef.current!)
          .bindPopup(
            `
          <div class="p-3">
            ${
              memory.category === 'Image' && memory.metadata?.url
                ? `<div class="mb-3 -mx-3 -mt-3">
                <img src="${memory.metadata.url}" alt="${memory.title}" class="w-full h-32 object-cover rounded-t-lg" />
              </div>`
                : ''
            }
            <div class="font-bold text-lg mb-1">${memory.title}</div>
            <div class="text-sm mb-2 text-muted-foreground">${memory.description || 'No description'}</div>
            <div class="text-xs text-muted-foreground">${new Date(memory.timestamp).toLocaleString()}</div>
            <div class="mt-2 flex items-center gap-2">
              <span class="text-xs inline-block px-2 py-1 rounded-full bg-primary/10 text-primary">
                ${memory.category}
              </span>
              ${
                memory.category === 'Video' && memory.metadata?.url
                  ? '<span class="text-xs text-muted-foreground">📹 Video</span>'
                  : ''
              }
              ${
                memory.category === 'Audio' && memory.metadata?.url
                  ? '<span class="text-xs text-muted-foreground">🎵 Audio</span>'
                  : ''
              }
            </div>
          </div>
        `,
            {
              className: 'custom-popup',
              maxWidth: 300,
              minWidth: 200,
              closeButton: true,
              autoClose: false,
            },
          );

        markers.push(marker);
        bounds.extend([memory.location.lat, memory.location.lng]);
      }
    });

    // Store markers reference
    markersRef.current = markers;

    // Add timeline path if enabled
    if (showTimeline && markers.length > 1) {
      // Create actual road routes using Google Maps JavaScript API
      const createRoadRoute = async (start: L.LatLng, end: L.LatLng) => {
        try {
          // Wait for Google Maps to load
          await waitForGoogleMaps();

          // Create Google Maps LatLng objects
          const googleStart = new window.google.maps.LatLng(start.lat, start.lng);
          const googleEnd = new window.google.maps.LatLng(end.lat, end.lng);

          // Create DirectionsService
          const directionsService = new window.google.maps.DirectionsService();

          // Request directions
          const request = {
            origin: googleStart,
            destination: googleEnd,
            travelMode: window.google.maps.TravelMode.DRIVING,
            avoidHighways: false,
            avoidTolls: false,
          };

          // Get directions
          const result = await new Promise<google.maps.DirectionsResult>((resolve, reject) => {
            directionsService.route(
              request,
              (result: google.maps.DirectionsResult | null, status: google.maps.DirectionsStatus) => {
                if (status === window.google.maps.DirectionsStatus.OK && result) {
                  resolve(result);
                } else {
                  reject(new Error(`Directions request failed: ${status}`));
                }
              },
            );
          });

          if (result.routes && result.routes.length > 0) {
            const route = result.routes[0];
            const overviewPath = route.overview_path;

            // Convert Google Maps LatLng to Leaflet LatLng
            const waypoints = overviewPath.map(
              (point: google.maps.LatLng) => new L.LatLng(point.lat(), point.lng()),
            );

            // Create the route path
            const polyline = L.polyline(waypoints, {
              color: primaryColor,
              weight: 5,
              opacity: 0.9,
              dashArray: '20, 10',
            }).addTo(mapRef.current!);

            polylinesRef.current.push(polyline);
          } else {
            createFallbackRoute(start, end);
          }
        } catch {
          createFallbackRoute(start, end);
        }
      };

      // Fallback route creation (straight line with some curves)
      const createFallbackRoute = (start: L.LatLng, end: L.LatLng) => {
        const distance = start.distanceTo(end);
        const numWaypoints = Math.max(3, Math.min(10, Math.floor(distance / 500)));

        const waypoints: L.LatLng[] = [];

        for (let i = 0; i <= numWaypoints; i++) {
          const ratio = i / numWaypoints;
          const curveIntensity = 0.002;
          const latOffset = Math.sin(ratio * Math.PI) * curveIntensity * (i % 2 === 0 ? 1 : -1);
          const lngOffset = Math.cos(ratio * Math.PI) * curveIntensity * (i % 2 === 0 ? 1 : -1);

          const waypoint = new L.LatLng(
            start.lat + (end.lat - start.lat) * ratio + latOffset,
            start.lng + (end.lng - start.lng) * ratio + lngOffset,
          );

          waypoints.push(waypoint);
        }

        const polyline = L.polyline(waypoints, {
          color: destructiveColor,
          weight: 3,
          opacity: 0.7,
          dashArray: '10, 5',
        }).addTo(mapRef.current!);

        polylinesRef.current.push(polyline);
      };

      // Create routes between consecutive points
      for (let i = 0; i < markers.length - 1; i++) {
        const start = markers[i].getLatLng();
        const end = markers[i + 1].getLatLng();
        await createRoadRoute(start, end);
      }
    }

    if (bounds.isValid()) {
      mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [memoriesWithLocation, showTimeline, clearMapElements]);

  // Initialize map (only once)
  useEffect(() => {
    const initializeMap = async () => {
      if (!mapContainerRef.current) {
        console.log('MapView: No map container ref');

        return;
      }

      console.log('MapView: Initializing map');

      // Fix for Leaflet's icon paths
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
      });

      // When switching tabs, we need to destroy and recreate the map
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      // Initialize map with a world view (will be adjusted to fit markers)
      mapRef.current = L.map(mapContainerRef.current).setView([20, 0], 2);

      // Use satellite imagery
      L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '',
          maxZoom: 20,
        },
      ).addTo(mapRef.current);

      // Add map controls
      if (!mapRef.current.zoomControl) {
        L.control.zoom({ position: 'bottomright' }).addTo(mapRef.current);
      }

      // Update markers after map is initialized
      updateMapMarkers();
    };

    // Add a small delay to ensure the container is fully rendered
    setTimeout(() => {
      initializeMap();
    }, 100);
  }, []); // Only run once on mount

  // Track previous memories to prevent unnecessary updates
  const [previousMemoriesHash, setPreviousMemoriesHash] = useState<string>('');

  // Create a hash of memories to detect actual changes
  const memoriesHash = useMemo(() => {
    return memoriesWithLocation.map((m) => `${m.id}-${m.location?.lat}-${m.location?.lng}`).join('|');
  }, [memoriesWithLocation]);

  // Update markers when memories actually change (not just search query)
  useEffect(() => {
    if (mapRef.current && memoriesHash !== previousMemoriesHash) {
      setPreviousMemoriesHash(memoriesHash);
      updateMapMarkers();
    }
  }, [memoriesHash, previousMemoriesHash]);

  // Update markers when showTimeline prop changes
  useEffect(() => {
    if (mapRef.current) {
      updateMapMarkers();
    }
  }, [showTimeline]);

  return (
    <div className={className}>
      <div
        ref={mapContainerRef}
        className="h-full w-full"
        style={{ touchAction: 'none' }}
        data-testid="map-container"
      />
    </div>
  );
}

// Desktop MapView with Timeline
export function DesktopMapView() {
  const [showTimeline, setShowTimeline] = useState(true);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-1 h-[calc(100vh-140px)] -mx-6 -mb-6">
      {/* Timeline - Left Column */}
      <div className="lg:col-span-1 flex flex-col overflow-hidden pl-4 pr-2">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border transition-colors cursor-pointer ${
              showTimeline
                ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                : 'bg-background text-foreground border-input hover:bg-accent hover:text-accent-foreground'
            }`}
            title={showTimeline ? 'Hide Timeline Path' : 'Show Timeline Path'}
          >
            <Route className="h-5 w-5" />
            Timeline
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden pr-1">
          <MemoryTimeline />
        </div>
      </div>

      {/* Map - Right Column */}
      <div className="lg:col-span-2 relative h-full">
        <MapView showTimeline={showTimeline} className="h-full" />
      </div>
    </div>
  );
}

// Mobile MapView
export function MobileMapView() {
  return (
    <div className="h-[calc(100vh-140px)] -mx-2 -mb-2">
      <MapView />
    </div>
  );
}
