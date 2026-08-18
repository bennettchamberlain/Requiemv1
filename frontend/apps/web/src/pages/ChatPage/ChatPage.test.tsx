import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import ChatPage from './ChatPage';
import type { Thread } from './types';

const navigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();

  return { ...actual, useNavigate: () => navigate };
});

const h = vi.hoisted(() => ({
  stop: vi.fn(),
  detach: vi.fn(),
  attach: vi.fn(async () => true),
  submit: vi.fn(async () => true),
  cancel: vi.fn(),
  deleteThread: vi.fn(),
  threads: [
    { id: 't1', name: 'First', description: null },
    { id: 't2', name: 'Second', description: null, generationStatus: 'running' },
  ] as Thread[],
  thread: {
    id: 't1',
    name: 'First',
    model: 'm',
    description: null,
    generationStatus: 'idle',
    messages: [],
  } as unknown as Thread,
}));

vi.mock('@ci/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ci/common')>();

  return {
    ...actual,
    usePageTitle: () => undefined,
    Portal: { Slot: ({ children }: { children: unknown }) => children },
  };
});

vi.mock('@/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks')>();

  return {
    ...actual,
    useChatRequester: () => [
      { stream: null, loading: false, error: null, streaming: false, hasStartedReceiving: null },
      { submit: h.submit, attach: h.attach, detach: h.detach, stop: h.stop, cancel: h.cancel },
    ],
    useModel: () => [{ selectedModel: 'llama3' }, {}],
    useCounter: () => [{ count: 0 }, { increment: vi.fn() }],
  };
});

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();

  return {
    ...actual,
    useThreadService: () => [{ thread: h.thread, loading: false }, { refetch: vi.fn() }],
  };
});

vi.mock('@/api/usePersonaCompose', () => ({
  usePersonaCompose: () => [
    { loading: false, error: null, result: null },
    { compose: vi.fn(), apply: vi.fn(), clear: vi.fn() },
  ],
}));

vi.mock('./useThreadListService', () => ({
  useThreadListService: () => [
    { threads: h.threads, loading: false, error: null },
    { refetch: vi.fn(), delete: h.deleteThread },
  ],
}));

vi.mock('@/lib/agentChat', () => ({
  readAgentChatContext: () => null,
  clearAgentChatContext: vi.fn(),
}));

vi.mock('@/components/Chat', () => ({
  Chat: ({ onStop }: { onStop?: () => void }) => (
    <button type="button" onClick={() => onStop?.()}>
      Stop
    </button>
  ),
}));

describe('ChatPage', () => {
  beforeEach(() => {
    navigate.mockClear();
    h.stop.mockClear();
    h.detach.mockClear();
    h.attach.mockClear();
    h.cancel.mockClear();
    h.deleteThread.mockClear();
    h.thread = {
      id: 't1',
      name: 'First',
      model: 'm',
      description: null,
      generationStatus: 'idle',
      messages: [],
    } as unknown as Thread;
  });

  it('detaches rather than stopping when selecting another thread', () => {
    renderWithProviders(<ChatPage />, { route: '/chat/t1', path: '/chat/:id' });

    fireEvent.click(screen.getByText('Second'));

    expect(h.stop).not.toHaveBeenCalled();
    expect(h.detach).toHaveBeenCalled();
  });

  it('attaches to a running thread when opening it', async () => {
    h.thread = {
      id: 't2',
      name: 'Second',
      description: null,
      generationStatus: 'running',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hi',
          model: 'm',
          mimetype: null,
          toolCalls: null,
          canceled: false,
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'Hel',
          model: 'm',
          mimetype: null,
          toolCalls: null,
          canceled: false,
        },
      ],
    } as unknown as Thread;

    renderWithProviders(<ChatPage />, { route: '/chat/t2', path: '/chat/:id' });

    await waitFor(() => expect(h.attach).toHaveBeenCalledWith('t2'));
  });

  it('Stop still cancels the in-flight job', () => {
    renderWithProviders(<ChatPage />, { route: '/chat/t1', path: '/chat/:id' });

    fireEvent.click(screen.getByText('Stop'));

    expect(h.stop).toHaveBeenCalled();
  });

  it('cancels generation when a thread is deleted', () => {
    renderWithProviders(<ChatPage />, { route: '/chat/t1', path: '/chat/:id' });

    fireEvent.click(screen.getAllByLabelText('Delete thread')[0]);

    expect(h.cancel).toHaveBeenCalledWith('t1');
    expect(h.deleteThread).toHaveBeenCalledWith('t1');
  });

  /**
   * Deleting the thread that is currently open must leave the chat pointed at
   * something real — the composer would otherwise keep submitting against a
   * thread id the server no longer has, and every reply after the delete
   * would 404. handleDeleteThread only takes this branch when the deleted id
   * matches the one currently open (t1, per the route below).
   */
  it('navigates back to the empty chat list when the currently-open thread is deleted', () => {
    renderWithProviders(<ChatPage />, { route: '/chat/t1', path: '/chat/:id' });

    fireEvent.click(screen.getAllByLabelText('Delete thread')[0]); // t1 — the open thread

    expect(h.deleteThread).toHaveBeenCalledWith('t1');
    expect(navigate).toHaveBeenCalledWith('/chat');
  });

  /**
   * The mirror case: deleting a thread from the sidebar while a *different*
   * thread is open (t2 here, not the open t1) must not knock the user out of
   * the conversation they're reading — only the matching-id branch navigates.
   */
  it('does not navigate away when a different thread is deleted from the sidebar', () => {
    renderWithProviders(<ChatPage />, { route: '/chat/t1', path: '/chat/:id' });

    fireEvent.click(screen.getAllByLabelText('Delete thread')[1]); // t2 — not open

    expect(h.cancel).toHaveBeenCalledWith('t2');
    expect(h.deleteThread).toHaveBeenCalledWith('t2');
    expect(navigate).not.toHaveBeenCalled();
  });
});
