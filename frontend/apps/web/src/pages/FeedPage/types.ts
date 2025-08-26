export interface Action {
  id: string;
  title: string;
  text: string;
  imageUrl?: string;
  threadId: string;
  tags: string[];
}

export interface FeedItem {
  id: string;
  title: string;
  description: React.ReactNode;
  tags: string[];
  imageUrl?: string;
}
