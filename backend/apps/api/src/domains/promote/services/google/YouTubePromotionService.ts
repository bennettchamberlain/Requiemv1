import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/services';
import { EventService, Events } from '@ci/domains/events';
import { ContentService, type CreateContentDto } from '@ci/domains/memory';

interface YouTubePlaylistItem {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
    resourceId?: {
      videoId?: string;
    };
  };
  contentDetails?: {
    videoId?: string;
    videoPublishedAt?: string;
  };
}

interface YouTubePlaylist {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
  contentDetails?: {
    itemCount?: number;
  };
}

@Injectable()
export class YouTubePromotionService {
  private logger = new LoggerService(YouTubePromotionService.name);

  constructor(
    private readonly contentService: ContentService,
    private readonly eventService: EventService,
  ) {}

  async promoteYouTubeData(apiLogContent: unknown, userId: string, connectionId: string): Promise<void> {
    this.logger.log('Starting YouTube data promotion', {
      userId,
      connectionId,
    });

    try {
      const data = this.extractYouTubeData(apiLogContent);

      if (!data) {
        this.logger.log('No YouTube data found to promote', { userId, connectionId });

        return;
      }

      this.logger.log(`Processing YouTube data: ${data.type}`, {
        userId,
        connectionId,
        type: data.type,
        itemCount: data.items.length,
      });

      if (data.type === 'likes') {
        await this.processLikes(data.items, userId, connectionId);
      } else if (data.type === 'playlists') {
        await this.processPlaylists(data.items, userId, connectionId);
      } else if (data.type === 'subscriptions') {
        await this.processSubscriptions(data.items, userId, connectionId);
      } else if (data.type === 'activities') {
        await this.processActivities(data.items, userId, connectionId);
      }

      this.logger.log('YouTube data promotion completed', {
        userId,
        connectionId,
        type: data.type,
        processedCount: data.items.length,
      });
    } catch (error) {
      this.logger.error('Error promoting YouTube data', {
        userId,
        connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private extractYouTubeData(content: unknown): {
    type: 'likes' | 'playlists' | 'subscriptions' | 'activities';
    items: unknown[];
  } | null {
    if (!content || typeof content !== 'object') {
      return null;
    }

    const contentObj = content as Record<string, unknown>;

    if ('type' in contentObj && 'items' in contentObj && Array.isArray(contentObj.items)) {
      const type = String(contentObj.type);
      if (type === 'likes' || type === 'playlists' || type === 'subscriptions' || type === 'activities') {
        return { type, items: contentObj.items };
      }
    }

    return null;
  }

  private async processLikes(items: unknown[], userId: string, connectionId: string): Promise<void> {
    for (const item of items) {
      try {
        await this.processLikedVideo(item as YouTubePlaylistItem, userId, connectionId);
      } catch (error) {
        this.logger.error('Error processing liked video', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private async processLikedVideo(
    item: YouTubePlaylistItem,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
    if (!videoId) {
      this.logger.debug('Skipping liked video without id');

      return;
    }

    const title = item.snippet?.title || 'Untitled Video';
    const description = item.snippet?.description || '';
    const channelTitle = item.snippet?.channelTitle || '';
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    const contentDto = {
      type: 'youtube_video_like',
      title,
      text: description,
      url,
      mimetype: 'video/youtube',
      external_id: videoId,
      source_url: url,
      source_data: { connectionId },
      event_id: '',
      user: { id: userId },
    };

    const createdContent = await this.contentService.create(
      { userId },
      contentDto as unknown as CreateContentDto,
    );
    const contentRecord = Array.isArray(createdContent) ? createdContent[0] : createdContent;
    const contentId = contentRecord?.id ?? String(contentDto.external_id ?? contentDto.type ?? '');
    await this.enqueueContentEmbedding(userId, contentId, this.buildContentSearchText(contentDto));

    this.logger.log('Processed liked YouTube video', {
      videoId,
      title,
      channelTitle,
    });
  }

  private async processPlaylists(items: unknown[], userId: string, connectionId: string): Promise<void> {
    for (const item of items) {
      try {
        await this.processPlaylist(item as YouTubePlaylist, userId, connectionId);
      } catch (error) {
        this.logger.error('Error processing playlist', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private async processPlaylist(item: YouTubePlaylist, userId: string, connectionId: string): Promise<void> {
    const playlistId = item.id;
    if (!playlistId) {
      this.logger.debug('Skipping playlist without id');

      return;
    }

    const title = item.snippet?.title || 'Untitled Playlist';
    const description = item.snippet?.description || '';
    const url = `https://www.youtube.com/playlist?list=${playlistId}`;
    const itemCount = item.contentDetails?.itemCount ?? 0;

    const contentDto = {
      type: 'youtube_playlist',
      title,
      text: description,
      url,
      external_id: playlistId,
      source_url: url,
      source_data: { connectionId },
      event_id: '',
      user: { id: userId },
    };

    const createdContent = await this.contentService.create(
      { userId },
      contentDto as unknown as CreateContentDto,
    );
    const contentRecord = Array.isArray(createdContent) ? createdContent[0] : createdContent;
    const contentId = contentRecord?.id ?? String(contentDto.external_id ?? contentDto.type ?? '');
    await this.enqueueContentEmbedding(userId, contentId, this.buildContentSearchText(contentDto));

    this.logger.log('Processed YouTube playlist', {
      playlistId,
      title,
      itemCount,
    });
  }

  private async processSubscriptions(items: unknown[], userId: string, connectionId: string): Promise<void> {
    for (const item of items) {
      try {
        await this.processSubscription(item as Record<string, unknown>, userId, connectionId);
      } catch (error) {
        this.logger.error('Error processing subscription', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private async processSubscription(
    item: Record<string, unknown>,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const snippet = item.snippet as Record<string, unknown> | undefined;
    if (!snippet) {
      this.logger.debug('Skipping subscription without snippet');

      return;
    }

    const channelId = snippet.resourceId
      ? ((snippet.resourceId as Record<string, unknown>).channelId as string)
      : '';
    const channelTitle = (snippet.title as string) || 'Untitled Channel';
    const description = (snippet.description as string) || '';
    const url = channelId ? `https://www.youtube.com/channel/${channelId}` : undefined;

    const contentDto = {
      type: 'youtube_subscription',
      title: channelTitle,
      text: description,
      url,
      external_id: channelId || undefined,
      source_url: url,
      source_data: { connectionId },
      user: { id: userId },
    };

    const createdContent = await this.contentService.create(
      { userId },
      contentDto as unknown as CreateContentDto,
    );
    const contentRecord = Array.isArray(createdContent) ? createdContent[0] : createdContent;
    const contentId = contentRecord?.id ?? String(contentDto.external_id ?? contentDto.type ?? '');
    await this.enqueueContentEmbedding(userId, contentId, this.buildContentSearchText(contentDto));

    this.logger.log('Processed YouTube subscription', {
      channelId,
      channelTitle,
    });
  }

  private async processActivities(items: unknown[], userId: string, connectionId: string): Promise<void> {
    for (const item of items) {
      try {
        await this.processActivity(item as Record<string, unknown>, userId, connectionId);
      } catch (error) {
        this.logger.error('Error processing activity', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private async enqueueContentEmbedding(ownerId: string, contentId: string, searchContent: string | null) {
    if (!searchContent || searchContent.trim().length === 0) {
      return;
    }

    try {
      await this.eventService.send(Events.SEARCH_EMBED_CONTENT, {
        ownerId,
        contentId,
        text: searchContent,
      });
    } catch (error) {
      this.logger.error('Failed to enqueue YouTube content embedding', {
        ownerId,
        contentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildContentSearchText(contentDto: Partial<CreateContentDto>): string | null {
    const parts = new Set<string>();
    const push = (value: unknown) => {
      if (typeof value !== 'string') {
        return;
      }

      const normalized = value.trim();
      if (normalized.length === 0) {
        return;
      }

      parts.add(normalized);
    };

    push(contentDto.title ?? null);
    push((contentDto as { text?: string }).text ?? null);
    push(contentDto.url ?? null);
    push(contentDto.type ?? null);

    if (parts.size === 0) {
      return null;
    }

    return Array.from(parts).join(' ');
  }

  private async processActivity(
    item: Record<string, unknown>,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const snippet = item.snippet as Record<string, unknown> | undefined;
    const contentDetails = item.contentDetails as Record<string, unknown> | undefined;

    if (!snippet) {
      this.logger.debug('Skipping activity without snippet');

      return;
    }

    const type = snippet.type as string;

    if (type === 'upload' && contentDetails?.upload) {
      const upload = contentDetails.upload as Record<string, unknown>;
      const videoId = upload.videoId as string | undefined;
      const title = (snippet.title as string) || 'Untitled Video';
      const description = (snippet.description as string) || '';
      const url = videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined;

      const contentDto = {
        type: 'youtube_activity_upload',
        title,
        text: description,
        url,
        external_id: videoId,
        source_url: url,
        source_data: { connectionId },
        event_id: '',
        user: { id: userId },
      };

      const createdContent = await this.contentService.create(
        { userId },
        contentDto as unknown as CreateContentDto,
      );
      const contentRecord = Array.isArray(createdContent) ? createdContent[0] : createdContent;
      const contentId = contentRecord?.id ?? String(contentDto.external_id ?? contentDto.type ?? '');
      await this.enqueueContentEmbedding(userId, contentId, this.buildContentSearchText(contentDto));

      this.logger.log('Processed YouTube upload activity', {
        videoId,
        title,
      });

      return;
    }

    this.logger.debug('Skipping unsupported YouTube activity', {
      type,
    });
  }
}
