import { createHmac } from 'crypto';
import { Readable } from 'stream';

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { LoggerService } from '@ci/common/services';
import config from '@ci/configuration';
import { EventService, Events } from '@ci/domains/events';
import { FileService, FileEntity } from '@ci/domains/files';
import { ContentService, type CreateContentDto, ContentEntity } from '@ci/domains/memory';
import { PersonService } from '@ci/domains/memory';

import { PromoteService } from '../PromoteService';

interface FacebookProfile {
  id: string;
  name: string;
  email?: string;
  age_range?: { min: number; max?: number };
  birthday?: string;
  gender?: string;
  hometown?: { id: string; name: string };
  link?: string;
  location?: { id: string; name: string };
}

interface FacebookPost {
  id: string;
  message?: string;
  created_time: string;
  story?: string;
  link?: string;
  type: string;
  full_picture?: string;
  picture?: string;
  attachments?: {
    data: Array<{
      media?: {
        image?: { src: string };
        video?: { source: string };
      };
      subattachments?: {
        data: Array<{
          media?: {
            image?: { src: string };
            video?: { source: string };
          };
        }>;
      };
    }>;
  };
}

interface FacebookPhoto {
  id: string;
  name?: string;
  created_time: string;
  images?: Array<{ height: number; width: number; source: string }>;
  link?: string;
  picture?: string;
}

interface FacebookVideo {
  id: string;
  title?: string;
  description?: string;
  created_time: string;
  source?: string;
  permalink_url?: string;
}

interface FacebookLike {
  id: string;
  name: string;
  category?: string;
  link?: string;
}

interface FacebookFriend {
  id: string;
  name: string;
  picture?: {
    data: {
      url: string;
    };
  };
}

@Injectable()
export class FacebookPromotionService {
  private logger = new LoggerService(FacebookPromotionService.name);

  constructor(
    private readonly contentService: ContentService,
    @InjectRepository(ContentEntity)
    private readonly contentRepository: Repository<ContentEntity>,
    private readonly fileService: FileService,
    @InjectRepository(FileEntity)
    private readonly fileRepository: Repository<FileEntity>,
    private readonly personService: PersonService,
    private readonly eventService: EventService,
    private readonly promoteService: PromoteService,
  ) {}

  async promoteFacebookData(
    apiLogContent: unknown,
    userId: string,
    connectionId: string,
    scope: string,
  ): Promise<void> {
    this.logger.log('Starting Facebook data promotion', {
      userId,
      connectionId,
      scope,
    });

    try {
      switch (scope) {
        case 'facebook profile':
          await this.promoteProfile(apiLogContent, userId, connectionId);
          break;
        case 'facebook posts':
          await this.promotePosts(apiLogContent, userId, connectionId);
          break;
        case 'facebook photos':
          // Photos are now consolidated into posts
          await this.promotePhotosAsPosts(apiLogContent, userId, connectionId);
          break;
        case 'facebook videos':
          // Videos are now consolidated into posts
          await this.promoteVideosAsPosts(apiLogContent, userId, connectionId);
          break;
        case 'facebook likes':
          await this.promoteLikes(apiLogContent, userId, connectionId);
          break;
        case 'facebook friends':
          await this.promoteFriends(apiLogContent, userId, connectionId);
          break;
        default:
          this.logger.warn('Unknown Facebook scope', { scope });
      }
    } catch (error) {
      this.logger.error('Error promoting Facebook data', {
        userId,
        connectionId,
        scope,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private async promoteProfile(apiLogContent: unknown, userId: string, connectionId: string): Promise<void> {
    this.logger.log('Promoting Facebook profile', { userId, connectionId });

    const profile = this.extractProfile(apiLogContent);
    if (!profile) {
      this.logger.log('No Facebook profile found to promote', { userId, connectionId });

      return;
    }

    // Get user entity ID
    const userEntityId = await this.promoteService.getUserEntityId(userId);

    // Search for existing person by facebook_id first (most reliable)
    let existingEntities = await this.personService.search(
      { userId },
      { properties: { facebook_id: profile.id, owner_user_id: userId } },
    );

    // If not found by facebook_id, try searching by email
    if (existingEntities.length === 0 && profile.email) {
      existingEntities = await this.personService.search(
        { userId },
        { properties: { email: profile.email, owner_user_id: userId } },
      );
    }

    // If still not found, try searching by name (case-insensitive)
    if (existingEntities.length === 0) {
      const nameParts = profile.name.trim().split(/\s+/).filter(Boolean);
      if (nameParts.length > 0) {
        // Search for persons with matching name (case-insensitive)
        const allPersons = await this.personService.search(
          { userId },
          { properties: { owner_user_id: userId } },
        );

        // Filter by case-insensitive name match
        existingEntities = allPersons.filter((person) => {
          const personName = person.name?.toLowerCase().trim();
          const profileName = profile.name.toLowerCase().trim();

          return personName === profileName;
        });
      }
    }

    const properties: Record<string, unknown> = {
      facebook_id: profile.id,
      owner_user_id: userId,
      connection_id: connectionId,
      sources: ['facebook'],
      facebook_data: {
        name: profile.name,
        email: profile.email,
        age_range: profile.age_range,
        birthday: profile.birthday,
        gender: profile.gender,
        hometown: profile.hometown,
        link: profile.link,
        location: profile.location,
        last_synced: new Date().toISOString(),
      },
    };

    // Store birthday directly in properties for easy access
    if (profile.birthday) {
      properties.birthday = profile.birthday;
    }

    if (profile.email) {
      properties.email = profile.email;
    }

    const nameParts = profile.name.trim().split(/\s+/).filter(Boolean);
    if (nameParts.length > 0) {
      properties.first_name = nameParts[0];
      if (nameParts.length > 1) {
        properties.last_name = nameParts.slice(1).join(' ');
      }
    }

    if (profile.gender) {
      properties.gender = profile.gender;
    }

    if (profile.hometown) {
      properties.hometown = profile.hometown.name;
    }

    if (profile.location) {
      properties.location = profile.location.name;
    }

    const searchContent = this.buildPersonSearchContent(profile.name, properties);

    if (existingEntities.length > 0) {
      // Update existing person
      const existingEntity = existingEntities[0];
      const currentProperties = (existingEntity.properties as Record<string, unknown>) ?? {};

      // Merge properties, ensuring Facebook data and birthday are updated
      const currentFacebookData = (currentProperties.facebook_data as Record<string, unknown>) || {};
      const newFacebookData = (properties.facebook_data as Record<string, unknown>) || {};

      const mergedProperties = {
        ...currentProperties,
        ...properties,
        // Ensure sources array includes 'facebook' if not already present
        sources: Array.isArray(currentProperties.sources)
          ? [...new Set([...currentProperties.sources, 'facebook'])]
          : ['facebook'],
        // Update facebook_data with latest info
        facebook_data: {
          ...currentFacebookData,
          ...newFacebookData,
        },
        // Ensure birthday is set if provided
        ...(profile.birthday ? { birthday: profile.birthday } : {}),
        // Ensure facebook_id is set
        ...(profile.id ? { facebook_id: profile.id } : {}),
      };

      // Update name if it's more complete
      const updatedName =
        existingEntity.name && existingEntity.name.length > profile.name.length
          ? existingEntity.name
          : profile.name;

      await this.personService.update({ userId }, existingEntity.id, {
        name: updatedName,
        properties: mergedProperties,
        lastAccessed: new Date(),
        searchContent: searchContent || undefined,
      });

      await this.enqueuePersonEmbedding(userId, existingEntity.id, searchContent);

      this.logger.log('Updated existing person with Facebook profile', {
        userId,
        entityId: existingEntity.id,
        name: updatedName,
        hasBirthday: !!profile.birthday,
      });
    } else {
      // Create new person
      const entityId = uuidv7();
      await this.personService.create(
        { userId },
        {
          id: entityId,
          name: profile.name,
          description: `Facebook profile: ${profile.name}`,
          properties,
          searchContent: searchContent || undefined,
        },
      );

      await this.enqueuePersonEmbedding(userId, entityId, searchContent);

      // Create relationship to user
      await this.eventService.send(Events.GRAPH_PERSON_CREATED, {
        ownerId: userId,
        person: {
          entityId,
          entityType: 'Person',
          name: profile.name,
        },
        relationships: [
          {
            fromEntityId: userEntityId,
            toEntityId: entityId,
            relationshipType: 'IS',
            properties: {
              source: 'facebook',
              connection_id: connectionId,
              last_interaction: new Date().toISOString(),
            },
          },
        ],
      });

      this.logger.log('Created new person from Facebook profile', {
        userId,
        entityId,
        name: profile.name,
        hasBirthday: !!profile.birthday,
      });
    }

    this.logger.log('Facebook profile promotion completed', { userId, connectionId });
  }

  private async promotePosts(apiLogContent: unknown, userId: string, connectionId: string): Promise<void> {
    this.logger.log('Promoting Facebook posts', { userId, connectionId });

    const posts = this.extractPosts(apiLogContent);
    if (posts.length === 0) {
      this.logger.log('No Facebook posts found to promote', { userId, connectionId });

      return;
    }

    for (const post of posts) {
      try {
        // Create a meaningful title from the post content
        const postTitle = post.message
          ? post.message.length > 100
            ? `${post.message.substring(0, 97)}...`
            : post.message
          : post.story
            ? post.story.length > 100
              ? `${post.story.substring(0, 97)}...`
              : post.story
            : `Facebook ${post.type || 'Post'}`;

        // Format created_time for display
        const createdDate = post.created_time ? new Date(post.created_time).toLocaleString() : undefined;

        // Extract media URLs from attachments if available and download them
        const mediaUrls: string[] = [];
        const fileIds: string[] = [];

        // Download full_picture if available
        if (post.full_picture) {
          mediaUrls.push(post.full_picture);
          try {
            const fileRecord = await this.downloadAndSaveFile(
              post.full_picture,
              `${post.id}_picture`,
              userId,
              connectionId,
              'image',
              `facebook photo ${post.id}_picture`,
            );
            if (fileRecord) {
              fileIds.push(fileRecord.id);
            }
          } catch (error) {
            this.logger.warn('Failed to download post picture', {
              postId: post.id,
              url: post.full_picture,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        // Process attachments
        if (post.attachments?.data) {
          for (const attachment of post.attachments.data) {
            if (attachment.media?.image?.src) {
              mediaUrls.push(attachment.media.image.src);
              try {
                const fileRecord = await this.downloadAndSaveFile(
                  attachment.media.image.src,
                  `${post.id}_attachment_image_${fileIds.length}`,
                  userId,
                  connectionId,
                  'image',
                  `facebook photo ${post.id}_attachment_${fileIds.length}`,
                );
                if (fileRecord) {
                  fileIds.push(fileRecord.id);
                }
              } catch (error) {
                this.logger.warn('Failed to download attachment image', {
                  postId: post.id,
                  url: attachment.media.image.src,
                  error: error instanceof Error ? error.message : 'Unknown error',
                });
              }
            }

            if (attachment.media?.video?.source) {
              mediaUrls.push(attachment.media.video.source);
              try {
                const fileRecord = await this.downloadAndSaveFile(
                  attachment.media.video.source,
                  `${post.id}_attachment_video_${fileIds.length}`,
                  userId,
                  connectionId,
                  'video',
                  `facebook video ${post.id}_attachment_${fileIds.length}`,
                );
                if (fileRecord) {
                  fileIds.push(fileRecord.id);
                }
              } catch (error) {
                this.logger.warn('Failed to download attachment video', {
                  postId: post.id,
                  url: attachment.media.video.source,
                  error: error instanceof Error ? error.message : 'Unknown error',
                });
              }
            }

            if (attachment.subattachments?.data) {
              for (const subattachment of attachment.subattachments.data) {
                if (subattachment.media?.image?.src) {
                  mediaUrls.push(subattachment.media.image.src);
                  try {
                    const fileRecord = await this.downloadAndSaveFile(
                      subattachment.media.image.src,
                      `${post.id}_subattachment_image_${fileIds.length}`,
                      userId,
                      connectionId,
                      'image',
                      `facebook photo ${post.id}_subattachment_${fileIds.length}`,
                    );
                    if (fileRecord) {
                      fileIds.push(fileRecord.id);
                    }
                  } catch (error) {
                    this.logger.warn('Failed to download subattachment image', {
                      postId: post.id,
                      url: subattachment.media.image.src,
                      error: error instanceof Error ? error.message : 'Unknown error',
                    });
                  }
                }

                if (subattachment.media?.video?.source) {
                  mediaUrls.push(subattachment.media.video.source);
                  try {
                    const fileRecord = await this.downloadAndSaveFile(
                      subattachment.media.video.source,
                      `${post.id}_subattachment_video_${fileIds.length}`,
                      userId,
                      connectionId,
                      'video',
                      `facebook video ${post.id}_subattachment_${fileIds.length}`,
                    );
                    if (fileRecord) {
                      fileIds.push(fileRecord.id);
                    }
                  } catch (error) {
                    this.logger.warn('Failed to download subattachment video', {
                      postId: post.id,
                      url: subattachment.media.video.source,
                      error: error instanceof Error ? error.message : 'Unknown error',
                    });
                  }
                }
              }
            }
          }
        }

        // Build comprehensive text description
        const textParts: string[] = [];
        if (post.message) {
          textParts.push(post.message);
        }

        if (post.story && post.story !== post.message) {
          textParts.push(post.story);
        }

        if (createdDate) {
          textParts.push(`Posted on ${createdDate}`);
        }

        if (fileIds.length > 0) {
          const mediaCount = fileIds.length;
          const mediaType =
            fileIds.length === 1 ? (fileIds[0] ? 'media file' : '') : `${mediaCount} media files`;
          if (mediaType) {
            textParts.push(`Includes ${mediaType}`);
          }
        }

        // Construct Facebook post URL if not provided
        let postLink = post.link;
        if (!postLink && post.id) {
          // Try to construct URL from post ID (format: {user_id}_{post_id})
          postLink = `https://www.facebook.com/${post.id}`;
        }

        // Always create a content record for the post, even if it has no media files
        const contentDto = {
          id: '',
          type: 'Content',
          title: postTitle,
          text: textParts.join('\n\n') || `Facebook post from ${createdDate || 'Facebook'}`,
          url: postLink || undefined,
          mimetype: 'text/plain',
          external_id: post.id,
          source_url: postLink || undefined,
          source_data: {
            facebook_post_id: post.id,
            created_time: post.created_time,
            created_time_formatted: createdDate,
            type: post.type,
            connection_id: connectionId,
            // Store all post metadata
            message: post.message,
            story: post.story,
            link: postLink,
            full_picture: post.full_picture,
            picture: post.picture,
            attachments: post.attachments,
            media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
            // Link to downloaded files (empty array if no files)
            file_ids: fileIds.length > 0 ? fileIds : undefined,
            // For backward compatibility, also store the first file_id if only one file
            file_id: fileIds.length === 1 ? fileIds[0] : undefined,
            // Store media count for easy reference
            media_count: fileIds.length,
          },
          user: { id: userId },
        };

        // Check if content already exists for this post (deduplication)
        const existingContent = await this.contentRepository.findOne({
          where: {
            user: { id: userId },
            external_id: post.id,
          },
        });

        if (existingContent) {
          this.logger.debug('Content record already exists for Facebook post, skipping', {
            postId: post.id,
            existingContentId: existingContent.id,
          });
          continue;
        }

        this.logger.log('Creating content record for Facebook post', {
          postId: post.id,
          title: postTitle,
          fileCount: fileIds.length,
          hasMessage: !!post.message,
          hasStory: !!post.story,
          type: contentDto.type,
          externalId: contentDto.external_id,
        });

        try {
          const createdContent = await this.contentService.create(
            { userId },
            contentDto as unknown as CreateContentDto,
          );
          const contentRecord = Array.isArray(createdContent) ? createdContent[0] : createdContent;
          const contentId = contentRecord?.id ?? post.id;

          this.logger.log('Successfully created content record for Facebook post', {
            postId: post.id,
            contentId,
            fileCount: fileIds.length,
            type: contentRecord.type,
          });

          await this.enqueueContentEmbedding(userId, contentId, this.buildContentSearchText(contentDto));
        } catch (contentError) {
          this.logger.error('Failed to create content record for Facebook post', {
            postId: post.id,
            error: contentError instanceof Error ? contentError.message : 'Unknown error',
            stack: contentError instanceof Error ? contentError.stack : undefined,
            contentDto: {
              type: contentDto.type,
              title: contentDto.title,
              external_id: contentDto.external_id,
            },
          });
          // Don't throw - continue processing other posts
        }
      } catch (error) {
        this.logger.error('Error processing Facebook post', {
          postId: post.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log('Facebook posts promotion completed', {
      userId,
      connectionId,
      processedCount: posts.length,
    });
  }

  /**
   * Promote Facebook photos: create files AND content records
   * Photos are stored as files and also have content records that reference those files
   */
  private async promotePhotosAsPosts(
    apiLogContent: unknown,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    this.logger.log('Promoting Facebook photos as files and content', { userId, connectionId });

    const photos = this.extractPhotos(apiLogContent);
    if (photos.length === 0) {
      this.logger.log('No Facebook photos found to promote', { userId, connectionId });

      return;
    }

    for (const photo of photos) {
      try {
        // Get the best quality image source
        const imageSource = this.getBestImageSource(photo);
        if (!imageSource) {
          this.logger.warn('No image source found for photo', { photoId: photo.id });
          continue;
        }

        // Download and save the image as a file
        const fileRecord = await this.downloadAndSaveFile(
          imageSource,
          photo.id,
          userId,
          connectionId,
          'image',
          `facebook photo ${photo.id}`,
        );

        if (!fileRecord) {
          this.logger.warn('Failed to save photo as file', { photoId: photo.id });
          continue;
        }

        // Only create file record - content records are created by promotePosts
        this.logger.log('Created file record for Facebook photo', {
          photoId: photo.id,
          fileId: fileRecord.id,
        });
      } catch (error) {
        this.logger.error('Error processing Facebook photo', {
          photoId: photo.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log('Facebook photos promotion completed (as files and content)', {
      userId,
      connectionId,
      processedCount: photos.length,
    });
  }

  /**
   * Promote Facebook videos: create files AND content records
   * Videos are stored as files and also have content records that reference those files
   */
  private async promoteVideosAsPosts(
    apiLogContent: unknown,
    userId: string,
    connectionId: string,
  ): Promise<void> {
    this.logger.log('Promoting Facebook videos as files and content', { userId, connectionId });

    const videos = this.extractVideos(apiLogContent);
    if (videos.length === 0) {
      this.logger.log('No Facebook videos found to promote', { userId, connectionId });

      return;
    }

    for (const video of videos) {
      try {
        if (!video.source) {
          this.logger.warn('No video source found', { videoId: video.id });
          continue;
        }

        // Download and save the video as a file
        const fileRecord = await this.downloadAndSaveFile(
          video.source,
          video.id,
          userId,
          connectionId,
          'video',
          `facebook video ${video.id}`,
        );

        if (!fileRecord) {
          this.logger.warn('Failed to save video as file', { videoId: video.id });
          continue;
        }

        // Only create file record - content records are created by promotePosts
        this.logger.log('Created file record for Facebook video', {
          videoId: video.id,
          fileId: fileRecord.id,
        });
      } catch (error) {
        this.logger.error('Error processing Facebook video', {
          videoId: video.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log('Facebook videos promotion completed (as files and content)', {
      userId,
      connectionId,
      processedCount: videos.length,
    });
  }

  private async promoteLikes(apiLogContent: unknown, userId: string, connectionId: string): Promise<void> {
    this.logger.log('Promoting Facebook likes', { userId, connectionId });

    const likes = this.extractLikes(apiLogContent);
    if (likes.length === 0) {
      this.logger.log('No Facebook likes found to promote', { userId, connectionId });

      return;
    }

    for (const like of likes) {
      try {
        const contentDto = {
          id: '',
          type: 'Content',
          title: like.name,
          text: like.category ? `Category: ${like.category}` : '',
          url: like.link || undefined,
          mimetype: 'text/plain',
          external_id: like.id,
          source_url: like.link || undefined,
          source_data: {
            facebook_like_id: like.id,
            category: like.category,
            connection_id: connectionId,
            contentType: 'facebook_like', // Store original type in source_data
          },
          user: { id: userId },
        };

        const createdContent = await this.contentService.create(
          { userId },
          contentDto as unknown as CreateContentDto,
        );
        const contentRecord = Array.isArray(createdContent) ? createdContent[0] : createdContent;
        const contentId = contentRecord?.id ?? like.id;

        await this.enqueueContentEmbedding(userId, contentId, this.buildContentSearchText(contentDto));
      } catch (error) {
        this.logger.error('Error processing Facebook like', {
          likeId: like.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log('Facebook likes promotion completed', {
      userId,
      connectionId,
      processedCount: likes.length,
    });
  }

  private async promoteFriends(apiLogContent: unknown, userId: string, connectionId: string): Promise<void> {
    this.logger.log('Promoting Facebook friends', { userId, connectionId });

    const friends = this.extractFriends(apiLogContent);
    if (friends.length === 0) {
      this.logger.log('No Facebook friends found to promote', { userId, connectionId });

      return;
    }

    const userEntityId = await this.promoteService.getUserEntityId(userId);

    for (const friend of friends) {
      try {
        const searchProperties: Record<string, unknown> = {
          owner_user_id: userId,
          facebook_id: friend.id,
        };

        const existingEntities = await this.personService.search(
          { userId },
          { properties: searchProperties },
        );

        const properties: Record<string, unknown> = {
          facebook_id: friend.id,
          owner_user_id: userId,
          connection_id: connectionId,
          sources: ['facebook'],
          facebook_data: {
            name: friend.name,
            picture_url: friend.picture?.data?.url,
            last_synced: new Date().toISOString(),
          },
        };

        const nameParts = friend.name.trim().split(/\s+/).filter(Boolean);
        if (nameParts.length > 0) {
          properties.first_name = nameParts[0];
          if (nameParts.length > 1) {
            properties.last_name = nameParts.slice(1).join(' ');
          }
        }

        const searchContent = this.buildPersonSearchContent(friend.name, properties);

        if (existingEntities.length > 0) {
          // Update existing person
          const existingEntity = existingEntities[0];
          const currentProperties = (existingEntity.properties as Record<string, unknown>) ?? {};
          const mergedProperties = { ...currentProperties, ...properties };

          await this.personService.update({ userId }, existingEntity.id, {
            properties: mergedProperties,
            lastAccessed: new Date(),
          });

          await this.enqueuePersonEmbedding(userId, existingEntity.id, searchContent);
        } else {
          // Create new person
          const entityId = uuidv7();
          await this.personService.create(
            { userId },
            {
              id: entityId,
              name: friend.name,
              description: `Facebook friend: ${friend.name}`,
              properties,
              searchContent: searchContent || undefined,
            },
          );

          await this.enqueuePersonEmbedding(userId, entityId, searchContent);

          // Create relationship to user
          await this.eventService.send(Events.GRAPH_PERSON_CREATED, {
            ownerId: userId,
            person: {
              entityId,
              entityType: 'Person',
              name: friend.name,
            },
            relationships: [
              {
                fromEntityId: userEntityId,
                toEntityId: entityId,
                relationshipType: 'FRIEND',
                properties: {
                  source: 'facebook',
                  connection_id: connectionId,
                  last_interaction: new Date().toISOString(),
                },
              },
            ],
          });
        }
      } catch (error) {
        this.logger.error('Error processing Facebook friend', {
          friendId: friend.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.logger.log('Facebook friends promotion completed', {
      userId,
      connectionId,
      processedCount: friends.length,
    });
  }

  private async downloadAndSaveFile(
    url: string,
    externalId: string,
    userId: string,
    connectionId: string,
    mediaType: 'image' | 'video',
    filename: string,
  ): Promise<{ id: string; contentType: string } | null> {
    try {
      // Download the file
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.error('Failed to download file', {
          url,
          status: response.status,
          statusText: response.statusText,
        });

        return null;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType =
        response.headers.get('content-type') || (mediaType === 'image' ? 'image/jpeg' : 'video/mp4');

      // Check if file already exists by hash or cloud_file_id
      const fileHash = createHmac('sha256', config.auth.session.fieldPepper).update(buffer).digest('hex');
      const existingFiles = await this.fileService.search(
        { userId },
        {
          file_hash: fileHash,
          content_type: contentType,
        },
      );

      // Also check by cloud_file_id (Facebook ID)
      if (existingFiles.length === 0) {
        const existingByCloudId = await this.fileService.search(
          { userId },
          {
            cloud_file_id: externalId,
            storage_provider: 'facebook',
          },
        );
        if (existingByCloudId.length > 0) {
          existingFiles.push(...existingByCloudId);
        }
      }

      if (existingFiles.length > 0) {
        this.logger.debug('File already exists, skipping upload', {
          fileId: existingFiles[0].id,
          url,
        });

        return {
          id: existingFiles[0].id,
          contentType: existingFiles[0].content_type,
        };
      }

      // Create a multer-like file object
      const fileExtension = this.getFileExtension(contentType, url);
      const fullFilename = filename.includes('.') ? filename : `${filename}.${fileExtension}`;

      // Create a Readable stream from the buffer
      const stream = Readable.from(buffer);

      const multerFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: fullFilename,
        encoding: '7bit',
        mimetype: contentType,
        size: buffer.length,
        buffer,
        destination: '',
        filename: fullFilename,
        path: '',
        stream,
      };

      // Upload to S3/MinIO
      const fileRecord = await this.fileService.upload({ userId }, multerFile);

      // Update file record with Facebook metadata (cloud_file_id and storage_provider)
      const fileEntity = await this.fileRepository.findOne({
        where: { id: fileRecord.id },
      });

      if (fileEntity) {
        fileEntity.cloud_file_id = externalId;
        fileEntity.storage_provider = 'facebook';
        await this.fileRepository.save(fileEntity);
        this.logger.debug('Updated file record with Facebook metadata', {
          fileId: fileRecord.id,
          cloudFileId: externalId,
        });
      }

      return {
        id: fileRecord.id,
        contentType: fileRecord.contentType,
      };
    } catch (error) {
      this.logger.error('Error downloading and saving file', {
        url,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return null;
    }
  }

  private getFileExtension(contentType: string, url: string): string {
    // Try to get extension from content type
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      return 'jpg';
    }

    if (contentType.includes('png')) {
      return 'png';
    }

    if (contentType.includes('gif')) {
      return 'gif';
    }

    if (contentType.includes('webp')) {
      return 'webp';
    }

    if (contentType.includes('mp4')) {
      return 'mp4';
    }

    if (contentType.includes('webm')) {
      return 'webm';
    }

    // Try to get extension from URL
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
      if (match) {
        return match[1].toLowerCase();
      }
    } catch {
      // Invalid URL, continue
    }

    // Default based on media type
    return 'jpg';
  }

  private getBestImageSource(photo: FacebookPhoto): string | null {
    if (!photo.images || photo.images.length === 0) {
      return photo.picture || photo.link || null;
    }

    // Sort by width * height to get the largest image
    const sortedImages = [...photo.images].sort((a, b) => b.width * b.height - a.width * a.height);

    return sortedImages[0]?.source || photo.picture || photo.link || null;
  }

  private extractProfile(content: unknown): FacebookProfile | null {
    if (!content || typeof content !== 'object') {
      return null;
    }

    const contentObj = content as Record<string, unknown>;
    if ('id' in contentObj && 'name' in contentObj) {
      return contentObj as unknown as FacebookProfile;
    }

    return null;
  }

  private extractPosts(content: unknown): FacebookPost[] {
    if (!content || typeof content !== 'object') {
      return [];
    }

    const contentObj = content as Record<string, unknown>;
    if (Array.isArray(contentObj)) {
      return contentObj as FacebookPost[];
    }

    if ('data' in contentObj && Array.isArray(contentObj.data)) {
      return contentObj.data as FacebookPost[];
    }

    return [];
  }

  private extractPhotos(content: unknown): FacebookPhoto[] {
    if (!content || typeof content !== 'object') {
      return [];
    }

    const contentObj = content as Record<string, unknown>;
    if (Array.isArray(contentObj)) {
      return contentObj as FacebookPhoto[];
    }

    if ('data' in contentObj && Array.isArray(contentObj.data)) {
      return contentObj.data as FacebookPhoto[];
    }

    return [];
  }

  private extractVideos(content: unknown): FacebookVideo[] {
    if (!content || typeof content !== 'object') {
      return [];
    }

    const contentObj = content as Record<string, unknown>;
    if (Array.isArray(contentObj)) {
      return contentObj as FacebookVideo[];
    }

    if ('data' in contentObj && Array.isArray(contentObj.data)) {
      return contentObj.data as FacebookVideo[];
    }

    return [];
  }

  private extractLikes(content: unknown): FacebookLike[] {
    if (!content || typeof content !== 'object') {
      return [];
    }

    const contentObj = content as Record<string, unknown>;
    if (Array.isArray(contentObj)) {
      return contentObj as FacebookLike[];
    }

    if ('data' in contentObj && Array.isArray(contentObj.data)) {
      return contentObj.data as FacebookLike[];
    }

    return [];
  }

  private extractFriends(content: unknown): FacebookFriend[] {
    if (!content || typeof content !== 'object') {
      return [];
    }

    const contentObj = content as Record<string, unknown>;
    if (Array.isArray(contentObj)) {
      return contentObj as FacebookFriend[];
    }

    if ('data' in contentObj && Array.isArray(contentObj.data)) {
      return contentObj.data as FacebookFriend[];
    }

    return [];
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
      this.logger.error('Failed to enqueue content embedding', {
        ownerId,
        contentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async enqueuePersonEmbedding(ownerId: string, entityId: string, searchContent: string | null) {
    if (!searchContent || searchContent.trim().length === 0) {
      return;
    }

    try {
      await this.eventService.send(Events.SEARCH_EMBED_ENTITY, {
        ownerId,
        entityId,
        entityType: 'Person',
        searchContent,
      });
    } catch (error) {
      this.logger.error('Failed to enqueue person embedding', {
        ownerId,
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private buildContentSearchText(contentDto: CreateContentDto): string | null {
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
    push(contentDto.mimetype ?? null);
    push(contentDto.url ?? null);

    if (parts.size === 0) {
      return null;
    }

    return Array.from(parts).join(' ');
  }

  private buildPersonSearchContent(
    name: string | null | undefined,
    properties?: Record<string, unknown>,
  ): string | null {
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

    push(name ?? null);

    const props: Record<string, unknown> = properties ?? {};
    const candidateKeys = ['first_name', 'last_name', 'email', 'occupation', 'bio', 'phone'];
    for (const key of candidateKeys) {
      push(props[key]);
    }

    if (parts.size === 0) {
      return null;
    }

    return Array.from(parts).join(' ');
  }
}
