import { useState, useEffect } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Tabs, Select, Button } from '@ci/shadcn';
import { Search, Filter, MapPin, List, Images, X, Loader2 } from '@ci/shadcn/icons';
import { useSearchParams } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import { useAuth } from '@/hooks';

import { MemoryTimeline, MobileMapView, useMemoryTimeline } from './Components';

// File metadata for gallery
interface FileMeta {
  id: string;
  name: string;
  contentType: string;
  size: string;
  url?: string;
}

function MobileMemoryPageContent() {
  usePageTitle('Memory - Companion Intelligence');
  const [{ authToken }] = useAuth();
  const { searchQuery, setSearchQuery } = useMemoryTimeline();
  const [, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState('list');

  // Gallery states
  const [galleryFiles, setGalleryFiles] = useState<FileMeta[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);

  // Mobile-specific states
  const [showFilters, setShowFilters] = useState(false);

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

  // Handle search
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
            <Breadcrumb.Item>
              <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Memory</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        {/* Mobile Header with Search and Filters */}
        <div className="space-y-3">
          {/* Search Bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <input
              type="search"
              className="block w-full p-3 pl-10 text-base border rounded-lg bg-background border-input text-foreground placeholder:text-muted-foreground"
              placeholder="Search memories..."
              value={searchQuery}
              onChange={handleSearchInputChange}
              onKeyDown={handleKeyPress}
            />
            {searchQuery && (
              <button
                className="absolute inset-y-0 right-0 flex items-center pr-3"
                onClick={() => setSearchQuery('')}
              >
                <X className="h-5 w-5 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Mobile Tab Navigation */}
          <div className="flex items-center justify-between">
            <Tabs defaultValue="list" className="flex-1" onValueChange={setActiveTab} value={activeTab}>
              <Tabs.List className="grid grid-cols-3 w-full">
                <Tabs.Trigger value="list" className="text-sm flex items-center gap-1">
                  <List className="h-4 w-4" />
                  List
                </Tabs.Trigger>
                <Tabs.Trigger value="map" className="text-sm flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  Map
                </Tabs.Trigger>
                <Tabs.Trigger value="gallery" className="text-sm flex items-center gap-1">
                  <Images className="h-4 w-4" />
                  Gallery
                </Tabs.Trigger>
              </Tabs.List>
            </Tabs>

            {/* Filter Toggle */}
            <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="ml-2">
              <Filter className="h-4 w-4" />
            </Button>
          </div>

          {/* Mobile Filters */}
          {showFilters && (
            <div className="space-y-3 p-3 bg-muted/50 rounded-lg">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Type</label>
                  <Select value="all" disabled>
                    <Select.Trigger className="w-full h-9 text-sm">
                      <Select.Value placeholder="All Entity Types" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="all">All Entity Types</Select.Item>
                    </Select.Content>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">Connection</label>
                  <Select value="all" disabled>
                    <Select.Trigger className="w-full h-9 text-sm">
                      <Select.Value placeholder="All Connections" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="all">All Connections</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
              </div>

              {activeTab === 'map' && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Memories with locations</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error Display */}
        {/* Content */}
        <>
          {activeTab === 'list' && <MemoryTimeline />}

          {activeTab === 'map' && <MobileMapView />}

          {activeTab === 'gallery' && (
            <>
              <div className="space-y-4">
                {/* Gallery Content */}
                {galleryLoading ? (
                  <div className="flex justify-center items-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
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
                              className="w-full h-32 object-cover rounded mb-2"
                              loading="lazy"
                            />
                            <div className="text-xs font-medium text-center truncate w-full text-card-foreground">
                              {file.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
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
                              className="w-full h-32 object-cover rounded mb-2 bg-black"
                              preload="metadata"
                            />
                            <div className="text-xs font-medium text-center truncate w-full text-card-foreground">
                              {file.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
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
                  <div className="text-center py-8">
                    <p className="text-muted-foreground text-sm">No content uploaded yet.</p>
                    <p className="text-sm text-muted-foreground mt-1">Use the + button to add new content.</p>
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

export default function MobileMemoryPage() {
  return <MobileMemoryPageContent />;
}
