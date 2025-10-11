import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import { ContentService, GraphUtilityService } from '@ci/domains/memory';
import { CreateContentDto } from '@ci/domains/memory/types';
import { UserEntity } from '@ci/domains/user';

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
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly contentService: ContentService,
    private readonly graphUtilityService: GraphUtilityService,
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
      } else if (data.type === 'history') {
        await this.processHistory(data.items, userId, connectionId);
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
    type: 'likes' | 'playlists' | 'history';
    items: unknown[];
  } | null {
    if (!content || typeof content !== 'object') {
      return null;
    }

    const contentObj = content as Record<string, unknown>;

    if ('type' in contentObj && 'items' in contentObj && Array.isArray(contentObj.items)) {
      const type = String(contentObj.type);
      if (type === 'likes' || type === 'playlists' || type === 'history') {
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
    const title = item.snippet?.title || 'Untitled Video';
    const description = item.snippet?.description || '';
    const channelTitle = item.snippet?.channelTitle || '';
    const channelId = item.snippet?.channelId || '';

    // Get user's entity ID (create if missing)
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn('User not found, skipping video', { userId, videoId });

      return;
    }

    let userEntityId = user.entityId;
    if (!userEntityId) {
      userEntityId = await this.ensureUserHasEntity(user);
    }

    // Create video entity
    const videoEntityId = uuid7();
    await this.graphUtilityService.createGraphNode({
      entityId: videoEntityId,
      entityType: 'Video',
      name: title,
      description: `YouTube video by ${channelTitle}`,
      properties: {
        video_id: videoId,
        channel_title: channelTitle,
        channel_id: channelId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        platform: 'youtube',
        thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url,
        published_at: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt,
        owner_user_id: userId,
      },
      searchContent: `${title} ${channelTitle} ${description}`,
      ownerUserId: userId,
    });

    // Create LIKED relationship
    await this.graphUtilityService.createRelationship(
      userEntityId,
      videoEntityId,
      'LIKED',
      {
        platform: 'youtube',
        connection_id: connectionId,
        liked_at: new Date().toISOString(),
      },
      1.0,
      userId,
    );

    // Save video metadata as content
    const contentDto = {
      id: '',
      type: 'youtube_video',
      title,
      text: description,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      external_id: videoId,
      user: { id: userId },
    };

    await this.contentService.create({ userId }, contentDto as CreateContentDto);

    this.logger.log('Processed liked YouTube video', {
      videoId,
      title,
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
    const title = item.snippet?.title || 'Untitled Playlist';
    const description = item.snippet?.description || '';

    // Get user's entity ID (create if missing)
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn('User not found, skipping playlist', { userId, playlistId });

      return;
    }

    let userEntityId = user.entityId;
    if (!userEntityId) {
      userEntityId = await this.ensureUserHasEntity(user);
    }

    // Create playlist entity
    const playlistEntityId = uuid7();
    await this.graphUtilityService.createGraphNode({
      entityId: playlistEntityId,
      entityType: 'Playlist',
      name: title,
      description,
      properties: {
        playlist_id: playlistId,
        url: `https://www.youtube.com/playlist?list=${playlistId}`,
        platform: 'youtube',
        item_count: item.contentDetails?.itemCount || 0,
        thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url,
        owner_user_id: userId,
      },
      searchContent: `${title} ${description}`,
      ownerUserId: userId,
    });

    // Create CREATED relationship
    await this.graphUtilityService.createRelationship(
      userEntityId,
      playlistEntityId,
      'CREATED',
      {
        platform: 'youtube',
        connection_id: connectionId,
        created_at: item.snippet?.publishedAt || new Date().toISOString(),
      },
      1.0,
      userId,
    );

    this.logger.log('Processed YouTube playlist', {
      playlistId,
      title,
    });
  }

  private async processHistory(items: unknown[], userId: string, connectionId: string): Promise<void> {
    for (const item of items) {
      try {
        await this.processHistoryVideo(item as YouTubePlaylistItem, userId, connectionId);
      } catch (error) {
        this.logger.error('Error processing history video', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private async processHistoryVideo(
    item: YouTubePlaylistItem,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
    const title = item.snippet?.title || 'Untitled Video';
    const channelTitle = item.snippet?.channelTitle || '';

    // Get user's entity ID (create if missing)
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      this.logger.warn('User not found, skipping history video', { userId, videoId });

      return;
    }

    let userEntityId = user.entityId;
    if (!userEntityId) {
      userEntityId = await this.ensureUserHasEntity(user);
    }

    // Create video entity (or find existing)
    const videoEntityId = uuid7();
    await this.graphUtilityService.createGraphNode({
      entityId: videoEntityId,
      entityType: 'Video',
      name: title,
      description: `YouTube video by ${channelTitle}`,
      properties: {
        video_id: videoId,
        channel_title: channelTitle,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        platform: 'youtube',
        owner_user_id: userId,
      },
      searchContent: `${title} ${channelTitle}`,
      ownerUserId: userId,
    });

    // Create WATCHED relationship
    await this.graphUtilityService.createRelationship(
      userEntityId,
      videoEntityId,
      'WATCHED',
      {
        platform: 'youtube',
        connection_id: connectionId,
        watched_at: new Date().toISOString(),
      },
      1.0,
      userId,
    );

    this.logger.log('Processed YouTube history video', {
      videoId,
      title,
    });
  }

  /**
   * Ensure a user has an entity in the graph
   * Creates one if it doesn't exist (for legacy users)
   */
  private async ensureUserHasEntity(user: UserEntity): Promise<string> {
    const entityId = uuid7();
    const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean);
    const [firstName, ...restName] = nameParts;

    const properties: Record<string, unknown> = {
      email: user.email,
      owner_user_id: user.id,
    };

    if (firstName) {
      properties.first_name = firstName;
    }

    if (restName.length > 0) {
      properties.last_name = restName.join(' ');
    }

    await this.graphUtilityService.createGraphNode({
      entityId,
      entityType: 'Person',
      name: user.name || user.email,
      description: `User: ${user.name || user.email}`,
      properties,
      searchContent: `${user.name || ''} ${user.email}`,
      linkedTable: 'users',
      linkedId: user.id,
      ownerUserId: user.id,
    });

    // Update the user record with the new entity ID
    await this.userRepository.update(user.id, { entityId });

    this.logger.log('Created entity for legacy user', {
      userId: user.id,
      entityId,
    });

    return entityId;
  }
}
