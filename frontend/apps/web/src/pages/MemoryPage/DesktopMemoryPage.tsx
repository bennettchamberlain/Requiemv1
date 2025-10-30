import { useState, useEffect, useCallback } from 'react';

import { Portal } from '@ci/common';
import { Breadcrumb, Tabs, Sheet } from '@ci/shadcn';
import { Search } from '@ci/shadcn/icons';
import { useSearchParams } from 'react-router-dom';

import { PageContent } from '@/components/layout';
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
  const { searchQuery, setSearchQuery, activeMemory, setActiveMemory } = useMemoryService();
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

  const handleSearch = useCallback(() => {
    // Update URL with search query while preserving existing parameters
    const currentParams = new URLSearchParams(searchParams);
    if (searchQuery.trim()) {
      currentParams.set('search', searchQuery.trim());
    } else {
      currentParams.delete('search');
    }

    setSearchParams(currentParams);
    // Search is automatically triggered when searchQuery changes in MemoryProvider
  }, [searchQuery, searchParams, setSearchParams]);

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

  const handleSearchInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchQuery(value);

      // Update URL with search query while preserving existing parameters
      const currentParams = new URLSearchParams(searchParams);
      if (value.trim()) {
        currentParams.set('search', value.trim());
      } else {
        currentParams.delete('search');
      }

      setSearchParams(currentParams);
    },
    [setSearchQuery, searchParams, setSearchParams],
  );

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
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
          <div className="flex flex-1">
            <div className="relative flex-grow">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <input
                type="search"
                className="block w-full p-2 pl-10 text-base border rounded-l-lg bg-background border-input text-foreground placeholder:text-muted-foreground"
                placeholder="Search memories..."
                value={searchQuery}
                onChange={handleSearchInputChange}
                onKeyDown={handleKeyPress}
              />
            </div>
            <button
              className="inline-flex items-center justify-center px-4 py-2 text-base font-medium bg-primary text-primary-foreground rounded-r-lg border border-primary hover:bg-primary/90 disabled:opacity-50"
              onClick={handleSearch}
            >
              <Search className="h-6 w-6" />
              <span className="ml-2">Search</span>
            </button>
          </div>

          <EntityTypeFilter
            selectedEntityTypes={selectedEntityTypes}
            onEntityTypesChange={handleEntityTypesChange}
          />

          {/* View Toggle */}
          <Tabs defaultValue="map" onValueChange={setActiveTab} value={activeTab}>
            <Tabs.List className="grid grid-cols-4 w-64">
              <Tabs.Trigger value="map" className="text-sm">
                Map
              </Tabs.Trigger>
              <Tabs.Trigger value="list" className="text-sm">
                List
              </Tabs.Trigger>
              <Tabs.Trigger value="gallery" className="text-sm">
                Gallery
              </Tabs.Trigger>
              <Tabs.Trigger value="graph" className="text-sm">
                Graph
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
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
