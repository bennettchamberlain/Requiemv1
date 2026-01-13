import { useState, useEffect, useCallback } from 'react';

import { Portal } from '@ci/common';
import { Breadcrumb, Tabs, Sheet, Tooltip } from '@ci/shadcn';
import { MapPin, List, Images, Share2 } from '@ci/shadcn/icons';
import { useSearchParams, Link } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import { SearchBox } from '@/components/SearchBox';
import { MemoryDetails } from '@/pages/MemoryPage/Components/MemoryDetails';

import { GalleryView } from './GalleryView';
import { GraphView } from './GraphView';
import { ListView } from './ListView';
import { DesktopMapView } from './MapView';
import { useMemoryService } from './useMemoryService';

export default function DesktopMemoryPage() {
  const { setSearchQuery, activeMemory, setActiveMemory } = useMemoryService();
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [activeTab, setActiveTab] = useState('map');

  useEffect(() => {
    setDetailsOpen(activeMemory != null);
  }, [activeMemory]);

  const toggleActiveMemory = (active: boolean) => {
    if (!active) {
      setActiveMemory(null);
    }
  };

  const handleSearch = useCallback(
    (data: { query: string; entityFilters?: string[] }) => {
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

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link asChild>
                <Link to="/feed">Companion</Link>
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Memory</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent className="p-0 gap-0">
        <div className="flex items-center gap-2 p-4">
          <div className="flex-1">
            <SearchBox onSearch={handleSearch} onClear={handleClear} autoSubmit displayFilters />
          </div>

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

        {activeTab === 'list' && <ListView />}
        {activeTab === 'map' && <DesktopMapView />}
        {activeTab === 'gallery' && <GalleryView />}
        {activeTab === 'graph' && <GraphView variant="desktop" />}
      </PageContent>

      {activeMemory && (
        <Sheet open={detailsOpen} onOpenChange={toggleActiveMemory}>
          <MemoryDetails memory={activeMemory} />
        </Sheet>
      )}
    </>
  );
}
