import { useState, useEffect } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Tabs, Select } from '@ci/shadcn';
import { Search, Filter, Loader2 } from '@ci/shadcn/icons';
import { useSearchParams } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import { useAuth } from '@/hooks';

import { MemoryTimeline, DesktopMapView, useMemoryTimeline } from './Components';

// File metadata for gallery
interface FileMeta {
  id: string;
  name: string;
  contentType: string;
  size: string;
  url?: string;
}

function DesktopMemoryPageContent() {
  usePageTitle('Memory - Companion Intelligence');
  const [{ authToken }] = useAuth();
  const { searchQuery, setSearchQuery } = useMemoryTimeline();
  const [, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState('map');

  console.log('DesktopMemoryPage: activeTab =', activeTab);

  // Gallery states
  const [galleryFiles, setGalleryFiles] = useState<FileMeta[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);

  // Fetch files for gallery
  const fetchGalleryFiles = async () => {
    setGalleryLoading(true);
    try {
      const res = await fetch('/api/files', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch file list');
      }

      const metaList: FileMeta[] = (await res.json()).map((file: FileMeta) => ({
        ...file,
        url: `/static${file.url}`,
      }));

      setGalleryFiles(metaList);
    } catch {
      // Silently fail - gallery is optional
    } finally {
      setGalleryLoading(false);
    }
  };

  // Load gallery files when gallery tab is active
  useEffect(() => {
    if (activeTab === 'gallery') {
      fetchGalleryFiles();
    }
  }, [activeTab, authToken]);

  const handleSearch = () => {
    // Update URL with search query
    if (searchQuery.trim()) {
      setSearchParams({ search: searchQuery.trim() });
    } else {
      setSearchParams({});
    }
    // Search is automatically triggered when searchQuery changes in MemoryProvider
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    // If the input is cleared, also clear the URL
    if (!value.trim()) {
      setSearchParams({});
    }
  };

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
        {/* Search Bar and Filters */}
        <div className="flex items-center w-full -mx-2">
          {/* Search Bar - Full Width */}
          <div className="relative flex-grow max-w-2xl pl-0 pr-2">
            <div className="flex">
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
                className="inline-flex items-center justify-center px-4 py-2 mr-4 text-base font-medium bg-primary text-primary-foreground rounded-r-lg border border-primary hover:bg-primary/90 disabled:opacity-50"
                onClick={handleSearch}
              >
                <Search className="h-6 w-6" />
                <span className="ml-2">Search</span>
              </button>
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-grow"></div>

          {/* Filters and View Toggle - Right Aligned */}
          <div className="flex items-center gap-4 relative z-[100] -mr-2">
            {/* Location Count */}
            <div className="text-base text-muted-foreground">Memories with locations</div>

            {/* Type Filter - Disabled */}
            <div className="flex items-center gap-2 relative z-[100]">
              <Filter className="h-6 w-6 text-muted-foreground" />
              <Select value="all" disabled>
                <Select.Trigger className="w-40 h-8 text-sm">
                  <Select.Value placeholder="All Entity Types" />
                </Select.Trigger>
                <Select.Content className="z-[100]">
                  <Select.Item value="all">All Entity Types</Select.Item>
                </Select.Content>
              </Select>
            </div>

            {/* Connection Filter - Disabled */}
            <div className="relative z-[100]">
              <Select value="all" disabled>
                <Select.Trigger className="w-40 h-8 text-sm">
                  <Select.Value placeholder="All Connections" />
                </Select.Trigger>
                <Select.Content className="z-[100]">
                  <Select.Item value="all">All Connections</Select.Item>
                </Select.Content>
              </Select>
            </div>

            {/* View Toggle */}
            <Tabs defaultValue="map" className="flex-shrink-0" onValueChange={setActiveTab} value={activeTab}>
              <Tabs.List className="grid grid-cols-2 w-32">
                <Tabs.Trigger value="map" className="text-sm">
                  Map
                </Tabs.Trigger>
                <Tabs.Trigger value="list" className="text-sm">
                  List
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>
          </div>
        </div>

        {/* Error Display */}
        {/* Content */}
        <>
          {activeTab === 'list' && <MemoryTimeline />}

          {activeTab === 'map' && <DesktopMapView />}

          {activeTab === 'gallery' && (
            <>
              <div className="space-y-6">
                {/* Gallery Content */}
                {galleryLoading ? (
                  <div className="flex justify-center items-center py-12">
                    <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {galleryFiles.map((file) => {
                      if (file.contentType.startsWith('image/')) {
                        return (
                          <div
                            key={file.id}
                            className="flex flex-col items-center border border-border rounded-lg p-2 bg-card text-card-foreground shadow hover:shadow-md transition-shadow"
                          >
                            <img
                              src={file.url}
                              alt={file.name}
                              className="w-full h-48 object-cover rounded mb-2"
                              loading="lazy"
                            />
                            <div className="text-sm font-medium text-center text-card-foreground">
                              {file.name}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {(Number(file.size) / 1024).toFixed(1)} KB
                            </div>
                          </div>
                        );
                      }

                      if (file.contentType.startsWith('video/')) {
                        return (
                          <div
                            key={file.id}
                            className="flex flex-col items-center border border-border rounded-lg p-2 bg-card text-card-foreground shadow hover:shadow-md transition-shadow"
                          >
                            <video
                              src={file.url}
                              controls
                              className="w-full h-48 object-cover rounded mb-2 bg-black"
                              preload="metadata"
                            />
                            <div className="text-sm font-medium text-center text-card-foreground">
                              {file.name}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {(Number(file.size) / 1024 / 1024).toFixed(1)} MB
                            </div>
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                )}

                {!galleryLoading && galleryFiles.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">No content uploaded yet.</p>
                    <p className="text-base text-muted-foreground mt-1">
                      Use the + button to add new content.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      </PageContent>
    </>
  );
}

export default function DesktopMemoryPage() {
  return <DesktopMemoryPageContent />;
}
