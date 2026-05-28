import { Injectable } from '@nestjs/common';

/**
 * Serialises hydrated search results into compact, human-readable lines for
 * LLM context injection.  Keeping token counts low is the primary goal.
 *
 * Format convention: "[label] Name — detail"
 *
 * This service is exported from AgentModule so it can be consumed by the
 * MCP domain without duplicating serialisation logic.
 */

// ---------------------------------------------------------------------------
// Hydrated result shapes — one per source table
// ---------------------------------------------------------------------------

/** Person, Concept, Event, Place, Item, Content — all live in ci.entities */
export type HydratedGraphEntity = {
  id: string;
  type: 'person' | 'concept' | 'event' | 'place' | 'item' | 'content';
  name: string | null;
  description: string | null;
  properties: Record<string, unknown>;
  searchContent: string | null;
};

export type HydratedCommunication = {
  id: string;
  type: 'communication';
  direction: string;
  content: string;
  summary: string | null;
  time: string;
};

export type HydratedNote = {
  id: string;
  type: 'note';
  title: string | null;
  content: string | null;
};

export type HydratedBrowserActivity = {
  id: string;
  type: 'browser-activity';
  url: string;
  title: string | null;
};

export type HydratedFile = {
  id: string;
  type: 'file';
  filename: string | null;
  title: string | null;
  description: string | null;
  contentType: string | null;
};

export type HydratedAnswer = {
  id: string;
  type: 'answer';
  answer: string;
};

export type HydratedThread = {
  id: string;
  type: 'thread';
  name: string | null;
  summary: string | null;
};

export type AnyHydratedResult =
  | HydratedGraphEntity
  | HydratedCommunication
  | HydratedNote
  | HydratedBrowserActivity
  | HydratedFile
  | HydratedAnswer
  | HydratedThread;

// ---------------------------------------------------------------------------
// Module-level helpers (pure, no side-effects)
// ---------------------------------------------------------------------------

function str(val: unknown): string {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : '';
}

/** Join non-empty parts with ' — ', discarding blanks. */
function join(label: string, ...details: (string | null | undefined)[]): string {
  const tail = details
    .map((d) => (typeof d === 'string' ? d.trim() : ''))
    .filter((d) => d.length > 0)
    .join(', ');

  return tail ? `${label} — ${tail}` : label;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SerializerService {
  // ---- per-type public methods (useful for callers that already know the type)

  serializePerson(name: string | null, description: string | null, props: Record<string, unknown>): string {
    const label = name ?? 'Unknown person';
    const parts: string[] = [];
    const occupation = str(props['occupation']);
    const age = props['age'] != null ? `age ${props['age']}` : '';
    if (occupation) {
      parts.push(occupation);
    }

    if (age) {
      parts.push(age);
    }

    const detail = parts.length > 0 ? parts.join(', ') : (description?.slice(0, 120) ?? '');

    return join(label, detail);
  }

  serializeConcept(name: string | null, description: string | null, props: Record<string, unknown>): string {
    const type = str(props['type']) || str(props['subtype']);
    const label = type ? `${name ?? 'Unknown concept'} (${type})` : (name ?? 'Unknown concept');

    return join(label, description?.slice(0, 120));
  }

  serializeEvent(name: string | null, description: string | null, props: Record<string, unknown>): string {
    const date = str(props['start_date']) || str(props['date']) || str(props['event_date']);
    const label = date ? `${name ?? 'Event'} [${date}]` : (name ?? 'Event');

    return join(label, description?.slice(0, 120));
  }

  serializePlace(name: string | null, description: string | null, props: Record<string, unknown>): string {
    const address = str(props['address']);

    return join(name ?? 'Unknown place', description?.slice(0, 100), address);
  }

  serializeItem(name: string | null, description: string | null, props: Record<string, unknown>): string {
    const condition = str(props['condition']);
    const quantity = props['quantity'] != null ? `qty: ${props['quantity']}` : '';
    const parts = [
      description?.slice(0, 80) ?? '',
      condition ? `condition: ${condition}` : '',
      quantity,
    ].filter(Boolean);

    return join(`[Item] ${name ?? 'Unknown item'}`, ...parts);
  }

  serializeContent(name: string | null, description: string | null, searchContent: string | null): string {
    const detail = description ?? searchContent?.slice(0, 120) ?? '';

    return join(`[Content] ${name ?? 'Untitled'}`, detail);
  }

  serializeCommunication(direction: string, content: string, summary: string | null, time: string): string {
    const date = new Date(time).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const snippet = (summary ?? content).slice(0, 200);

    return `[${direction}, ${date}] "${snippet}"`;
  }

  serializeNote(title: string | null, content: string | null): string {
    return join(`[Note] ${title ?? 'Untitled'}`, content?.slice(0, 120));
  }

  serializeBrowserActivity(url: string, title: string | null): string {
    const label = title ? `[Browser] ${title}` : `[Browser] ${url.slice(0, 80)}`;
    const detail = title && url !== title ? url.slice(0, 80) : '';

    return join(label, detail);
  }

  serializeFile(
    filename: string | null,
    title: string | null,
    description: string | null,
    contentType: string | null,
  ): string {
    const name = title ?? filename ?? 'Unknown file';
    const meta = contentType ? `(${contentType})` : '';

    return join(`[File] ${name}`, meta, description?.slice(0, 80));
  }

  serializeAnswer(answer: string): string {
    return `[Answer] "${answer.slice(0, 200)}"`;
  }

  serializeThread(name: string | null, summary: string | null): string {
    return join(`[Thread] ${name ?? 'Untitled'}`, summary?.slice(0, 120));
  }

  // ---- dispatch

  serialize(result: AnyHydratedResult): string {
    switch (result.type) {
      case 'person':
        return this.serializePerson(result.name, result.description, result.properties);
      case 'concept':
        return this.serializeConcept(result.name, result.description, result.properties);
      case 'event':
        return this.serializeEvent(result.name, result.description, result.properties);
      case 'place':
        return this.serializePlace(result.name, result.description, result.properties);
      case 'item':
        return this.serializeItem(result.name, result.description, result.properties);
      case 'content':
        return this.serializeContent(result.name, result.description, result.searchContent);
      case 'communication':
        return this.serializeCommunication(result.direction, result.content, result.summary, result.time);
      case 'note':
        return this.serializeNote(result.title, result.content);
      case 'browser-activity':
        return this.serializeBrowserActivity(result.url, result.title);
      case 'file':
        return this.serializeFile(result.filename, result.title, result.description, result.contentType);
      case 'answer':
        return this.serializeAnswer(result.answer);
      case 'thread':
        return this.serializeThread(result.name, result.summary);
    }
  }
}
