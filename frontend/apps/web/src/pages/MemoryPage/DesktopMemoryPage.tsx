import { useState, useEffect, useCallback } from 'react';

import { Portal } from '@ci/common';
import { Breadcrumb, Tabs, Sheet, Tooltip } from '@ci/shadcn';
import { MapPin, List, Images, Share2 } from '@ci/shadcn/icons';
import { useSearchParams } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import { SearchBox } from '@/components/SearchBox';
import { MemoryDetails } from '@/pages/MemoryPage/Components/MemoryDetails';

import { EntityTypeFilter } from './Components/EntityTypeFilter';
import { GalleryView } from './GalleryView';
import { GraphView } from './GraphView';
import { ListView } from './ListView';
import { DesktopMapView } from './MapView';
import { useMemoryService } from './useMemoryService';

const AVAILABLE_ENTITY_TYPES = [
  'Person',
  'Event',
  'Content',
  'Browser',
  'Thing',
  'Contact',
  'Place',
  'Location',
  'Document',
  'File',
  'Channel',
  'Video',
  'Communication',
];

export default function DesktopMemoryPage() {
  const { setSearchQuery, activeMemory, setActiveMemory } = useMemoryService();
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [activeTab, setActiveTab] = useState('map');

  // types state - by default all are selected (none excluded)
  const [selectedEntityTypes, setSelectedEntityTypes] = useState<string[]>(AVAILABLE_ENTITY_TYPES);

  // Initialize entity types from URL parameters
  useEffect(() => {
    const excludedEntityTypes = searchParams.get('excludedEntityTypes')?.split(',').filter(Boolean) || [];
    const selectedTypes = AVAILABLE_ENTITY_TYPES.filter((type) => !excludedEntityTypes.includes(type));
    setSelectedEntityTypes(selectedTypes);
  }, [searchParams]);

  useEffect(() => {
    setDetailsOpen(activeMemory != null);
  }, [activeMemory]);

  const toggleActiveMemory = (active: boolean) => {
    if (!active) {
      setActiveMemory(null);
    }
  };

  const handleSearch = useCallback(
    (data: { query: string }) => {
      setSearchQuery(data.query);

      const currentParams = new URLSearchParams(searchParams);

      if (data.query.trim()) {
        currentParams.set('search', data.query.trim());
      } else {
        currentParams.delete('search');
      }

      setSearchParams(currentParams);
    },
    [setSearchQuery, searchParams, setSearchParams],
  );

  const handleClear = useCallback(() => {
    setSearchQuery('');

    const currentParams = new URLSearchParams(searchParams);

    currentParams.delete('search');

    setSearchParams(currentParams);
  }, [setSearchQuery, searchParams, setSearchParams]);

  const handleEntityTypesChange = useCallback(
    (entityTypes: string[]) => {
      setSelectedEntityTypes(entityTypes);

      // Calculate excluded entity types (all available types minus selected ones)
      const excludedEntityTypes = AVAILABLE_ENTITY_TYPES.filter((type) => !entityTypes.includes(type));

      // Update URL with excluded entity types
      const currentParams = new URLSearchParams(searchParams);
      if (excludedEntityTypes.length > 0) {
        currentParams.set('excludedEntityTypes', excludedEntityTypes.join(','));
      } else {
        currentParams.delete('excludedEntityTypes');
      }

      setSearchParams(currentParams);
    },
    [searchParams, setSearchParams],
  );

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link href="/">Companion</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Memory</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <SearchBox onSearch={handleSearch} onClear={handleClear} autoSubmit />
          </div>

          <EntityTypeFilter
            selectedEntityTypes={selectedEntityTypes}
            onEntityTypesChange={handleEntityTypesChange}
          />

          {/* View Toggle */}
          <Tooltip.Provider>
            <Tabs defaultValue="map" onValueChange={setActiveTab} value={activeTab}>
              <Tabs.List className="flex items-center justify-center h-11.5 border-1">
                <Tabs.Trigger value="map">
                  <Tooltip delayDuration={600}>
                    <Tooltip.Trigger className="flex items-center justify-center h-4 w-6">
                      <MapPin />
                    </Tooltip.Trigger>
                    <Tooltip.Content side="bottom">Map view</Tooltip.Content>
                  </Tooltip>
                </Tabs.Trigger>
                <Tabs.Trigger value="list">
                  <Tooltip delayDuration={600}>
                    <Tooltip.Trigger className="flex items-center justify-center h-4 w-6">
                      <List />
                    </Tooltip.Trigger>
                    <Tooltip.Content side="bottom">List view</Tooltip.Content>
                  </Tooltip>
                </Tabs.Trigger>
                <Tabs.Trigger value="gallery">
                  <Tooltip delayDuration={600}>
                    <Tooltip.Trigger className="flex items-center justify-center h-4 w-6">
                      <Images />
                    </Tooltip.Trigger>
                    <Tooltip.Content side="bottom">Gallery view</Tooltip.Content>
                  </Tooltip>
                </Tabs.Trigger>
                <Tabs.Trigger value="graph">
                  <Tooltip delayDuration={600}>
                    <Tooltip.Trigger className="flex items-center justify-center h-4 w-6">
                      <Share2 />
                    </Tooltip.Trigger>
                    <Tooltip.Content side="bottom">Graph view</Tooltip.Content>
                  </Tooltip>
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>
          </Tooltip.Provider>
        </div>

        {/* Content */}
        <>
          {activeTab === 'list' && <ListView />}

          {activeTab === 'map' && <DesktopMapView />}

          {activeTab === 'gallery' && <GalleryView />}

          {activeTab === 'graph' && <GraphView variant="desktop" />}
        </>
      </PageContent>

      {activeMemory && (
        <Sheet open={detailsOpen} onOpenChange={toggleActiveMemory}>
          <MemoryDetails memory={activeMemory} />
        </Sheet>
      )}
    </>
  );
}
