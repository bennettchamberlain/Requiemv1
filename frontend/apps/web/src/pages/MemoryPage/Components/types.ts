export interface MemoryItem {
  id: string;
  type:
    | 'event'
    | 'content'
    | 'thing'
    | 'person'
    | 'contact'
    | 'place'
    | 'concept'
    | 'communication'
    | 'other';
  title: string;
  description: string | null;
  timestamp: string;
  category: string;
  location?: {
    id: string;
    name: string | null;
    lat: number;
    lng: number;
    address?: string;
  };
  tags: string[];
  userId: string;
  metadata?: {
    communicationType?: string;
    direction?: string;
    participantsMetadata?: unknown;
    source?: string;
    relationships?: Array<{
      type: string;
      targetId: string;
      targetName: string;
      targetType: string;
      direction: 'outgoing' | 'incoming';
    }>;
    [key: string]: unknown;
  };
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  organizer?: string;
  repeatingFrequency?: string;
  duration?: number;
  source?: string;
  sourceLink?: string;
}

export interface MemoryCardProps {
  memory: MemoryItem;
}

export type Relationship = {
  type: string;
  targetId: string;
  targetName: string;
  targetType: string;
  direction: 'outgoing' | 'incoming';
};

export interface ParticipantData {
  name?: string;
  email?: string;
}
