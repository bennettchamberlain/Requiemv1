export interface Memory {
  id: string;
  type: 'event' | 'content' | 'thing' | 'person' | 'contact';
  title: string;
  description: string | null;
  timestamp: Date;
  category: string;
  location?: MemoryLocation;
  tags: string[];
  userId: string;
  metadata?: {
    eventId?: string;
    eventType?: string;
    eventName?: string;
    synthetic?: boolean;
    personRef?: string;
    contentRef?: string;
    thingRef?: string;
    [key: string]: unknown;
  };
}

export interface MemoryLocation {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  address?: string;
  placeId?: string;
}

export interface MemorySearchParams {
  query?: string;
  startDate?: Date;
  endDate?: Date;
  categories?: string[];
  hasLocation?: boolean;
  limit?: number;
  offset?: number;
}

export interface MemoryResponse {
  data: Memory[];
  total: number;
  limit: number;
  offset: number;
}
export interface Event {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly start_time: Date;
  readonly end_time: Date;
  readonly external_id: string;
  readonly source_url: string;
  readonly source_data: string
  readonly user_id: string;
  readonly connection_id: string;
}

export interface CreateEventDto {
  id: string;
  name: string;
  type: string;
  description: string;
  start_time: Date;
  end_time: Date;
  external_id: string;
  source_url: string;
  source_data: string
  user_id: string;
  connection_id: string;
}

export interface UpdateEventDto {
  id?: string;
  name?: string;
  type?: string;
  description?: string;
  start_time?: Date;
  end_time?: Date;
  external_id?: string;
  source_url?: string;
  source_data?: string
  user_id?: string;
  connection_id?: string;
}

export interface Content {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly text: string;
  readonly url: string;
  readonly mimetype: string;
  readonly external_id: string;
  readonly source_url: string;
  readonly user_id: string;
  readonly event_id: string;
}

export interface CreateContentDto {
  id: string;
  type: string;
  title: string;
  text: string;
  url: string;
  mimetype: string;
  external_id: string;
  source_url: string;
  user_id: string;
  event_id: string;
}

export interface UpdateContentDto {
  id: string;
  type: string;
  title: string;
  text: string;
  url: string;
  mimetype: string;
  external_id: string;
  source_url: string;
  user_id: string;
  event_id: string;
}
