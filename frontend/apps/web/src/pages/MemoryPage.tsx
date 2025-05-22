import * as React from 'react';
import { useState } from 'react';
import { Calendar, Clock, Coffee, Search, ShoppingCart, Utensils, BookOpen, Dumbbell, Car, Laptop, Tv, User } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from '@/components/ui/separator';

// Sample memory data
interface MemoryItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  category: string;
  icon: React.ReactNode;
}

const sampleMemories: MemoryItem[] = [
  {
    id: "mem-1",
    title: "Morning Coffee",
    description: "Had a cappuccino at Blue Bottle Coffee while reading the news",
    timestamp: "2025-05-21T07:30:00Z",
    category: "Food & Drink",
    icon: <Coffee className="h-5 w-5" />
  },
  {
    id: "mem-2",
    title: "Team Meeting",
    description: "Weekly sync with the product team about the new feature launch",
    timestamp: "2025-05-21T10:00:00Z",
    category: "Work",
    icon: <Laptop className="h-5 w-5" />
  },
  {
    id: "mem-3",
    title: "Lunch with Sarah",
    description: "Met Sarah at the Italian restaurant to catch up about her new job",
    timestamp: "2025-05-21T12:30:00Z",
    category: "Social",
    icon: <Utensils className="h-5 w-5" />
  },
  {
    id: "mem-4",
    title: "Gym Session",
    description: "45 minutes of strength training and 20 minutes of cardio",
    timestamp: "2025-05-21T17:00:00Z",
    category: "Fitness",
    icon: <Dumbbell className="h-5 w-5" />
  },
  {
    id: "mem-5",
    title: "Grocery Shopping",
    description: "Picked up ingredients for dinner and restocked on essentials",
    timestamp: "2025-05-21T18:30:00Z",
    category: "Errands",
    icon: <ShoppingCart className="h-5 w-5" />
  },
  {
    id: "mem-6",
    title: "Cooking Dinner",
    description: "Made pasta primavera with fresh vegetables from the farmers market",
    timestamp: "2025-05-21T19:30:00Z",
    category: "Food & Drink",
    icon: <Utensils className="h-5 w-5" />
  },
  {
    id: "mem-7",
    title: "Reading Session",
    description: "Read three chapters of 'The Psychology of Money' before bed",
    timestamp: "2025-05-21T21:00:00Z",
    category: "Learning",
    icon: <BookOpen className="h-5 w-5" />
  },
  {
    id: "mem-8",
    title: "Call with Mom",
    description: "Caught up with mom about her garden and upcoming visit",
    timestamp: "2025-05-21T20:00:00Z",
    category: "Family",
    icon: <User className="h-5 w-5" />
  },
  {
    id: "mem-9",
    title: "Drive to Work",
    description: "Commuted to the office while listening to the Daily podcast",
    timestamp: "2025-05-21T08:30:00Z",
    category: "Transportation",
    icon: <Car className="h-5 w-5" />
  },
  {
    id: "mem-10",
    title: "Evening Show",
    description: "Watched two episodes of the new sci-fi series on Netflix",
    timestamp: "2025-05-21T22:00:00Z",
    category: "Entertainment",
    icon: <Tv className="h-5 w-5" />
  }
];

export function MemoryPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [memories] = useState<MemoryItem[]>(sampleMemories);
  
  // Filter memories based on search query
  const filteredMemories = searchQuery.trim() === '' 
    ? memories 
    : memories.filter(memory => 
        memory.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        memory.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        memory.category.toLowerCase().includes(searchQuery.toLowerCase())
      );

  return (
    <div className="flex flex-col w-full h-full">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="text-xl font-semibold">Memory</h1>
      </header>
      
      <div className="flex flex-col gap-6 p-6">
        {/* Search Bar */}
        <div className="relative w-full max-w-2xl mx-auto">
          <div className="flex">
            <div className="relative flex-grow">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Search className="h-4 w-4 text-muted-foreground" />
              </div>
              <input
                type="search"
                className="block w-full p-2 pl-10 text-sm border rounded-l-lg bg-background border-input"
                placeholder="Search memories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && console.log('Searching for:', searchQuery)}
              />
            </div>
            <button
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-r-lg border border-primary hover:bg-primary/90"
              onClick={() => console.log('Searching for:', searchQuery)}
            >
              Search
            </button>
          </div>
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
            <div className="rounded-lg border p-4">
              <h3 className="text-lg font-medium mb-4">Today's Activities</h3>
              
              {filteredMemories.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">No memories found matching your search.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredMemories.map((memory) => (
                    <div key={memory.id} className="flex items-start gap-4 p-4 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div className="flex-shrink-0 p-2 bg-primary/10 rounded-full">
                        {memory.icon}
                      </div>
                      <div className="flex-grow min-w-0">
                        <div className="flex justify-between items-start">
                          <h4 className="font-medium truncate">{memory.title}</h4>
                          <div className="flex items-center text-muted-foreground text-sm">
                            <Clock className="h-3 w-3 mr-1" />
                            {new Date(memory.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <p className="text-muted-foreground text-sm mt-1">{memory.description}</p>
                        <div className="mt-2">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10">
                            {memory.category}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
