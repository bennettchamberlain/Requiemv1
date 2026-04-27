import { Injectable } from '@nestjs/common';

import {
  CHUNK_OVERLAP_CHARS,
  CHUNK_TARGET_CHARS,
  CHUNKER_VERSION,
  type CreateChunkDto,
  type ParsedDocument,
} from '../types';

@Injectable()
export class DocumentChunkerService {
  /**
   * Convert a ParsedDocument into a flat list of chunk DTOs, applying
   * target-size windowing with overlap when a section exceeds CHUNK_TARGET_CHARS.
   */
  chunkDocument(fileId: string, userId: string, doc: ParsedDocument): CreateChunkDto[] {
    const chunks: CreateChunkDto[] = [];
    let globalIndex = 0;

    for (const section of doc.sections) {
      const text = section.text.trim();

      if (!text) {
        continue;
      }

      if (text.length <= CHUNK_TARGET_CHARS) {
        chunks.push({
          fileId,
          userId,
          chunkIndex: globalIndex++,
          content: text,
          sectionTitle: section.title ?? null,
          sourceLocator: Object.keys(section.metadata).length ? section.metadata : null,
          parserName: doc.parser.name,
          parserVersion: doc.parser.version,
          chunkerVersion: CHUNKER_VERSION,
        });
      } else {
        // Split at paragraph boundaries with overlap
        const windows = this.splitWithOverlap(text);

        for (const window of windows) {
          chunks.push({
            fileId,
            userId,
            chunkIndex: globalIndex++,
            content: window,
            sectionTitle: section.title ?? null,
            sourceLocator: Object.keys(section.metadata).length ? section.metadata : null,
            parserName: doc.parser.name,
            parserVersion: doc.parser.version,
            chunkerVersion: CHUNKER_VERSION,
          });
        }
      }
    }

    return chunks;
  }

  /**
   * Split a long text into overlapping windows, preferring paragraph boundaries.
   */
  private splitWithOverlap(text: string): string[] {
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const windows: string[] = [];
    let current = '';

    for (const para of paragraphs) {
      const candidate = current ? `${current}\n\n${para}` : para;

      if (candidate.length <= CHUNK_TARGET_CHARS) {
        current = candidate;
      } else {
        if (current) {
          windows.push(current.trim());
          // Start next window with overlap from the tail of current
          const overlap = current.slice(-CHUNK_OVERLAP_CHARS);
          current = overlap ? `${overlap}\n\n${para}` : para;
        } else {
          // Single paragraph exceeds target — hard-split with overlap
          const hardSplits = this.hardSplit(para);
          windows.push(...hardSplits);
          current = '';
        }
      }
    }

    if (current.trim()) {
      windows.push(current.trim());
    }

    return windows.length > 0 ? windows : [text.trim()];
  }

  /**
   * Hard-split a single block of text with overlap when no paragraph breaks exist.
   */
  private hardSplit(text: string): string[] {
    const results: string[] = [];
    let offset = 0;

    while (offset < text.length) {
      const end = Math.min(offset + CHUNK_TARGET_CHARS, text.length);
      results.push(text.slice(offset, end).trim());
      offset += CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS;
    }

    return results.filter((r) => r.length > 0);
  }
}
