import { Injectable } from '@nestjs/common';

import { toServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { type Connection } from '@ci/domains/connections';
import { ContentService } from '@ci/domains/memory';

import { ConnectionSyncJob } from '../../../types';

interface SteamGame {
  appid: number;
  name: string;
  playtime_forever: number;
  img_icon_url?: string;
  has_community_visible_stats?: boolean;
  playtime_windows_forever?: number;
  playtime_mac_forever?: number;
  playtime_linux_forever?: number;
  playtime_deck_forever?: number;
  rtime_last_played?: number;
  playtime_disconnected?: number;
}

@Injectable()
export class SteamOwnedGamesTransformService {
  constructor(
    private readonly contentService: ContentService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SteamOwnedGamesTransformService.name);
  }

  async transform({
    connection,
    syncJob,
  }: {
    connection: Connection;
    syncJob: ConnectionSyncJob;
  }) {
    const { userId, data } = syncJob;

    this.logger.log('Starting Steam Owned Games transformation', {
      userId,
      connectionId: connection.id,
    });

    try {
      const context = toServiceContext({ userId });
      const games = (data?.games as SteamGame[]) || [];

      if (games.length === 0) {
        this.logger.log('No Steam games found to transform', {
          userId,
          connectionId: connection.id,
        });

        return;
      }

      let createdCount = 0;
      let skippedCount = 0;

      for (const game of games) {
        try {
          const existingContent = await this.contentService.search(context, {
            type: 'game',
            external_id: String(game.appid),
          });

          if (existingContent.length > 0) {
            this.logger.debug('Game already exists, skipping', {
              appid: game.appid,
              name: game.name,
            });
            skippedCount++;
            continue;
          }

          await this.contentService.create(context, {
            type: 'game',
            title: game.name,
            url: `https://store.steampowered.com/app/${game.appid}`,
            external_id: String(game.appid),
            source_data: {
              appid: game.appid,
              playtime_forever: game.playtime_forever,
              img_icon_url: game.img_icon_url,
              playtime_windows_forever: game.playtime_windows_forever,
              playtime_mac_forever: game.playtime_mac_forever,
              playtime_linux_forever: game.playtime_linux_forever,
              playtime_deck_forever: game.playtime_deck_forever,
              rtime_last_played: game.rtime_last_played,
            },
          });

          createdCount++;

          this.logger.debug('Game transformed and stored', {
            appid: game.appid,
            name: game.name,
          });
        } catch (error) {
          this.logger.error('Failed to transform individual game', {
            appid: game.appid,
            name: game.name,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      this.logger.log('Steam Owned Games transformation completed', {
        userId,
        connectionId: connection.id,
        totalGames: games.length,
        gamesCreated: createdCount,
        gamesSkipped: skippedCount,
      });
    } catch (error) {
      this.logger.error('Failed to transform Steam Owned Games', {
        userId,
        connectionId: connection.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }
}

