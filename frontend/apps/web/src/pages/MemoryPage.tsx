import * as React from 'react';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from '@/components/ui/separator';

export function MemoryPage() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex flex-col w-full h-full">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="text-xl font-semibold">Memory</h1>
      </header>
      
      <div className="flex flex-col gap-6 p-6">
        {/* Search Bar */}
        <div className="relative w-full max-w-2xl mx-auto">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <Search className="h-4 w-4 text-muted-foreground" />
          </div>
          <input
            type="search"
            className="block w-full p-2 pl-10 text-sm border rounded-lg bg-background border-input"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <Separator className="my-2" />
        
        {/* Tabs */}
        <Tabs defaultValue="list" className="w-full">
          <TabsList className="grid grid-cols-5 w-full max-w-2xl mx-auto">
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="feed">Feed</TabsTrigger>
            <TabsTrigger value="map">Map</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
          </TabsList>
          
          <TabsContent value="list" className="mt-6">
            <div className="rounded-lg border p-8 text-center">
              <h3 className="text-lg font-medium">List View</h3>
              <p className="text-muted-foreground mt-2">
                Your memories will be displayed in a list format here.
              </p>
            </div>
          </TabsContent>
          
          <TabsContent value="feed" className="mt-6">
            <div className="rounded-lg border p-8 text-center">
              <h3 className="text-lg font-medium">Feed View</h3>
              <p className="text-muted-foreground mt-2">
                Your memories will be displayed in a feed format here.
              </p>
            </div>
          </TabsContent>
          
          <TabsContent value="map" className="mt-6">
            <div className="rounded-lg border p-8 text-center">
              <h3 className="text-lg font-medium">Map View</h3>
              <p className="text-muted-foreground mt-2">
                Your memories will be displayed on a map here.
              </p>
            </div>
          </TabsContent>
          
          <TabsContent value="calendar" className="mt-6">
            <div className="rounded-lg border p-8 text-center">
              <h3 className="text-lg font-medium">Calendar View</h3>
              <p className="text-muted-foreground mt-2">
                Your memories will be displayed in a calendar format here.
              </p>
            </div>
          </TabsContent>
          
          <TabsContent value="insights" className="mt-6">
            <div className="rounded-lg border p-8 text-center">
              <h3 className="text-lg font-medium">Insights</h3>
              <p className="text-muted-foreground mt-2">
                Analytics and insights about your memories will be displayed here.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
