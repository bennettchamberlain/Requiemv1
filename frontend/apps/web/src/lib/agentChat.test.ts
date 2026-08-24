import { describe, expect, it, vi } from 'vitest';

import {
  formatAgentChatDraft,
  openAgentHarness,
  stashAgentChatContext,
  readAgentChatContext,
  clearAgentChatContext,
  type AgentChatContext,
} from './agentChat';

describe('formatAgentChatDraft', () => {
  it('includes the title and body when both are present', () => {
    expect(formatAgentChatDraft({ title: 'Picnic', body: 'Bring snacks' })).toBe(
      'I\'d like to talk about "Picnic":\n\nBring snacks',
    );
  });

  it('falls back to the title alone', () => {
    expect(formatAgentChatDraft({ title: 'Picnic' })).toBe('I\'d like to talk about "Picnic".');
  });
});

describe('openAgentHarness', () => {
  it('opens the harness URL with prompt, context, and memory ids', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const context: AgentChatContext = {
      title: 'Picnic',
      body: 'Bring snacks',
      sourceKind: 'NoteType',
      sourceId: 'note-1',
    };

    openAgentHarness('https://openclaw.example/chat', context);

    const opened = new URL(String(open.mock.calls[0]?.[0]));
    expect(opened.origin + opened.pathname).toBe('https://openclaw.example/chat');
    expect(opened.searchParams.get('title')).toBe('Picnic');
    expect(opened.searchParams.get('prompt')).toBe('I\'d like to talk about "Picnic":\n\nBring snacks');
    expect(opened.searchParams.get('context')).toBe('Bring snacks');
    expect(opened.searchParams.get('memoryKind')).toBe('NoteType');
    expect(opened.searchParams.get('memoryId')).toBe('note-1');
    expect(open.mock.calls[0]?.[1]).toBe('_blank');

    open.mockRestore();
  });
});

describe('agent chat session seed', () => {
  it('round-trips context through sessionStorage', () => {
    stashAgentChatContext({ title: 'Picnic', body: 'Bring snacks', sourceKind: 'NoteType' });
    expect(readAgentChatContext()).toEqual({
      title: 'Picnic',
      body: 'Bring snacks',
      sourceKind: 'NoteType',
    });
    clearAgentChatContext();
    expect(readAgentChatContext()).toBeNull();
  });
});
