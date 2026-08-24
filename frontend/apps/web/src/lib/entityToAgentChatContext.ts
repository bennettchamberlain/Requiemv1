import type { AgentChatContext } from '@/lib/agentChat';
import { formatMinor } from '@/lib/money';
import { eventDisplayTitle } from '@/pages/MemoryPage/Components/utils';
import { getFileChunkTitle } from '@/pages/MemoryPage/fileChunks';
import type { MemoryEntity } from '@/pages/MemoryPage/useEntityService';

function asRecord(entity: MemoryEntity): Record<string, unknown> {
  return entity as unknown as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function readNestedString(value: unknown, key: string): string | null {
  if (value == null || typeof value !== 'object') {
    return null;
  }

  const nested = (value as Record<string, unknown>)[key];

  return typeof nested === 'string' && nested.trim().length > 0 ? nested.trim() : null;
}

function stripHtml(html: string): string {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function fallbackTitle(kind: string): string {
  return kind.replace(/Type$/, '').replace(/([a-z])([A-Z])/g, '$1 $2') || 'This memory';
}

/**
 * Turn a Memory explorer entity into chat-about context. Search results are
 * fragment-masked, so fields are read defensively off the runtime object.
 */
export function entityToAgentChatContext(entity: MemoryEntity): AgentChatContext {
  const record = asRecord(entity);
  const sourceKind = entity.__typename;
  const sourceId = typeof entity.id === 'string' ? entity.id : undefined;

  let title: string | null = null;
  let body: string | null = null;

  switch (entity.__typename) {
    case 'EventType':
      title = eventDisplayTitle({
        title: readString(record, 'title', 'galleryTitle'),
        startTime: (record.startTime ?? record.bucketStartTime) as string | Date | null,
        locationName: readString(record, 'locationName', 'galleryLocationName'),
        mediaContentType: readString(record, 'mediaContentType', 'galleryMediaContentType'),
      });
      body = readString(record, 'description');
      break;

    case 'NoteType': {
      title = readString(record, 'title') ?? 'Untitled note';
      const content = readString(record, 'content');
      body = content ? stripHtml(content) : null;
      break;
    }

    case 'CommunicationType':
      title = readString(record, 'subject', 'preview') ?? 'Untitled communication';
      body = readString(record, 'preview');
      break;

    case 'ContentType':
      title = readString(record, 'title', 'galleryTitle') ?? 'Untitled content';
      body = readString(record, 'text');
      break;

    case 'PersonType':
    case 'PlaceType':
    case 'ConceptType':
    case 'ThreadType':
    case 'ItemType':
      title = readString(record, 'name') ?? fallbackTitle(entity.__typename);
      body = readString(record, 'description');
      break;

    case 'FileType':
      title = readString(record, 'title', 'filename', 'galleryFilename') ?? 'Untitled file';
      body = readString(record, 'description', 'filename', 'galleryFilename');
      break;

    case 'FileChunkType':
      title = getFileChunkTitle({
        sectionTitle: readString(record, 'sectionTitle'),
        chunkContent: readString(record, 'chunkContent', 'content') ?? undefined,
        sourceLocator: (record.sourceLocator as Record<string, unknown> | null) ?? null,
        file: {
          filename: readNestedString(record.file, 'filename'),
        },
      });
      body = readString(record, 'chunkContent', 'content');
      break;

    case 'BrowserActivityType':
      title = readString(record, 'title') ?? 'Untitled page';
      body = readString(record, 'url');
      break;

    case 'AnswerType':
      title = readNestedString(record.question, 'text') ?? 'Answer';
      body = readString(record, 'answer');
      break;

    case 'ReceiptType': {
      title = readString(record, 'merchantName') ?? 'Unknown merchant';
      const total = formatMinor(
        typeof record.totalMinor === 'number' ? record.totalMinor : null,
        readString(record, 'receiptCurrency', 'currency'),
      );
      const lines = Array.isArray(record.lineItems) ? record.lineItems.length : 0;
      body = [total, lines > 0 ? `${lines} ${lines === 1 ? 'line' : 'lines'}` : null]
        .filter(Boolean)
        .join(' · ');
      break;
    }

    case 'ProductModelType':
      title = readString(record, 'productTitle', 'title') ?? 'Untitled product';
      body = [readString(record, 'brand'), readString(record, 'modelNumber', 'model')]
        .filter(Boolean)
        .join(' · ');
      break;

    case 'GenericEntity':
      title =
        readString(record, 'name') ??
        (typeof record.entityType === 'string' ? fallbackTitle(record.entityType) : null) ??
        'This memory';
      body = readString(record, 'description');
      break;

    default:
      title =
        readString(record, 'title', 'name', 'productTitle', 'merchantName', 'filename') ??
        fallbackTitle(sourceKind);
      body = readString(record, 'description', 'text', 'preview', 'content');
      break;
  }

  return {
    title: title?.trim() || 'This memory',
    body: body && body.trim().length > 0 ? body.trim() : null,
    sourceKind,
    sourceId,
  };
}
