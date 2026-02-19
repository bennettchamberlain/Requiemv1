import type { BaseClient, Connection, FacebookPost } from '@ci/domains/connections';

export async function syncDrive({
  connection,
  client,
  nextCursor,
  historical = false,
}: {
  connection: Connection;
  client: BaseClient;
  nextCursor: Record<string, unknown>;
  historical: boolean;
}): Promise<{ data: Record<string, unknown>; nextCursor?: Record<string, unknown> }> {
  try {
    if (historical) {
      client.logger.log('Performing historical Drive sync', {
        connectionId: connection.id,
        nextCursor,
      });

      const fieldsList =
        'id,message,created_time,story,link,type,full_picture,picture,attachments{media,subattachments}';

      const params = new URLSearchParams({
        fields: fieldsList,
      });

      const endpoint = nextCursor.nextLink || `/v21.0/me/posts?${params.toString()}`;
      const response = (await client.request(connection, endpoint)) as Record<string, unknown>;
      const posts = (response.data as FacebookPost[]) || [];
      const nextLink = response.paging?.next as string | undefined;

      client.logger.log('Facebook Posts historical sync call completed', {
        connectionId: connection.id,
        fileCount: posts.length,
        hasNextPage: !!nextLink,
      });

      return {
        data: {
          posts,
        },
        nextCursor: nextLink
          ? {
            nextLink,
          }
          : {},
      };
    } else {
      client.logger.log('Performing incremental Facebook Posts sync', {
        connectionId: connection.id,
        nextCursor,
      });

      const fieldsList =
        'id,message,created_time,story,link,type,full_picture,picture,attachments{media,subattachments}';

      const since = nextCursor.since || (connection.createdAt.getTime() / 1000).toString();
      const params = new URLSearchParams({
        fields: fieldsList,
        since: nextCursor.since
      });

      const posts: FacebookPost[] = [];
      let nextLink
      do {
        const endpoint = `/v21.0/me/posts?${params.toString()}`;
        const response = (await client.request(connection, endpoint)) as Record<string, unknown>;
        posts = posts.concat(response.data as FacebookPost[] || []);
        nextLink = response.paging?.next as string | undefined;
      } while (nextLink != null)

      client.logger.log('Facebook Posts historical sync call completed', {
        connectionId: connection.id,
        fileCount: posts.length,
        hasNextPage: !!nextLink,
      });

      return {
        data: {
          posts,
        },
        nextCursor: {
          since: new Date().getTime(),
        }
      };
    }
  } catch (err) {
    client.logger.error('Error during Drive sync', {
      connectionId: connection.id,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    throw err;
  }
}
