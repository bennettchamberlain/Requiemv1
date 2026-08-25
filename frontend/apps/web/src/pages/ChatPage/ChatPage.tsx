import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Button, Card } from '@ci/shadcn';
import { RefreshCw, Send, X } from '@ci/shadcn/icons';
import { useNavigate, useParams } from 'react-router-dom';

import { useThreadService } from '@/api';
import { Chat, type FormData } from '@/components/Chat';
import { useChatRequester, useCounter, useModel } from '@/hooks';
import { clearAgentChatContext, formatAgentChatDraft, readAgentChatContext } from '@/lib/agentChat';

import { ChatSidebar } from './ChatSidebar';
import { type Message } from './types';
import { useThreadListService } from './useThreadListService';

function ChatPageContent() {
  const resolvedThreadId = useRef<string | null>(null);
  const hasSetInitialMessages = useRef(false);
  const lastProcessedResponseRef = useRef<string>('');
  const threadTitleRefreshTimeoutRef = useRef<number | null>(null);

  const navigate = useNavigate();

  const { id: initialThreadId } = useParams<{ id?: string }>();
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [{ selectedModel }] = useModel();

  const [
    { threads, loading: threadsLoading, error: threadsError },
    { refetch: refetchThreads, delete: deleteThread },
  ] = useThreadListService();

  const [{ thread, loading: threadLoading }, { refetch: refetchThread }] = useThreadService(
    resolvedThreadId.current,
  );

  const [{ count: newThreadCount }, { increment: incrementNewThreadCount }] = useCounter();

  const handleNewThread = useCallback(
    (threadId: string) => {
      resolvedThreadId.current = threadId;
      window.history.replaceState({}, '', `/chat/${threadId}`);
      refetchThreads();
      refetchThread();
    },
    [refetchThreads],
  );

  const [
    { stream, loading: chatRequestLoading, streaming: chatRequestStreaming, hasStartedReceiving },
    {
      submit: submitChatRequest,
      stop: stopChatRequest,
      attach: attachChatStream,
      detach: detachChatStream,
      cancel: cancelGeneration,
    },
  ] = useChatRequester({
    threadId: resolvedThreadId.current,
    onNewThread: handleNewThread,
  });

  const navigateToChatList = useCallback(() => {
    incrementNewThreadCount();
    detachChatStream();
    resolvedThreadId.current = null;
    navigate('/chat');
  }, [incrementNewThreadCount, detachChatStream, navigate]);

  useEffect(() => {
    setInitialMessages([]);
    hasSetInitialMessages.current = initialThreadId ? false : true;
    resolvedThreadId.current = initialThreadId ?? null;
  }, [initialThreadId]);

  useEffect(() => {
    if (initialThreadId) {
      return;
    }

    const seed = readAgentChatContext();

    if (!seed) {
      return;
    }

    clearAgentChatContext();
    setChatDraft(formatAgentChatDraft(seed));
  }, [initialThreadId]);

  useEffect(() => {
    if (thread && !hasSetInitialMessages.current) {
      const generating = thread.generationStatus === 'queued' || thread.generationStatus === 'running';
      const loaded = thread.messages ?? [];
      const last = loaded[loaded.length - 1];
      const messages = generating && last?.role === 'assistant' ? loaded.slice(0, -1) : loaded;

      setInitialMessages(messages);
      hasSetInitialMessages.current = true;

      if (generating && thread.id) {
        void attachChatStream(thread.id).then((attached) => {
          if (!attached) {
            setInitialMessages(loaded);
          }
        });
      }
    }
  }, [thread, attachChatStream]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      if (resolvedThreadId.current !== threadId) {
        detachChatStream();
        navigate(`/chat/${threadId}`);
      }
    },
    [navigate, detachChatStream],
  );

  const handleDeleteThread = useCallback(
    (threadId: string) => {
      cancelGeneration(threadId);
      deleteThread(threadId);

      if (resolvedThreadId.current === threadId) {
        navigateToChatList();
      }
    },
    [cancelGeneration, deleteThread, navigateToChatList],
  );

  const handleSubmit = useCallback(
    async (data: FormData, e?: FormEvent) => {
      e?.preventDefault();

      return submitChatRequest(data);
    },
    [submitChatRequest],
  );

  useEffect(() => {
    return () => {
      if (threadTitleRefreshTimeoutRef.current != null) {
        window.clearTimeout(threadTitleRefreshTimeoutRef.current);
      }
    };
  }, []);

  const handleResponseFinished = useCallback(
    (text: string) => {
      if (text.trim() && text !== lastProcessedResponseRef.current) {
        lastProcessedResponseRef.current = text;
      }

      refetchThreads();
      if (threadTitleRefreshTimeoutRef.current != null) {
        window.clearTimeout(threadTitleRefreshTimeoutRef.current);
      }

      threadTitleRefreshTimeoutRef.current = window.setTimeout(() => {
        refetchThreads();
      }, 5000);
    },
    [refetchThreads],
  );

  const loading = threadsLoading || threadLoading || chatRequestLoading;
  const isSubmitDisabled = selectedModel == null;
  const inputPlaceholder =
    resolvedThreadId.current == null
      ? 'Ask about Memory, Plan, Forecast, Brief…'
      : 'Continue — Memory, Plan, Forecast, Brief…';

  let emptyState: ReactNode;

  if (threadsError) {
    emptyState = (
      <Card className="border-destructive/20 bg-destructive/5">
        <Card.Content className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0">
              <X className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-destructive mb-2">Error loading threads</h3>
              <p className="text-sm text-destructive/80 mb-4">{String(threadsError)}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={refetchThreads}
                className="border-destructive/20 text-destructive hover:bg-destructive/10"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
            </div>
          </div>
        </Card.Content>
      </Card>
    );
  } else if (resolvedThreadId.current == null) {
    emptyState = (
      <div className="flex w-full max-w-xl flex-col items-center px-4 text-gray-500">
        <div className="mb-4 mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-stone-100">
          <Send className="relative -left-0.5 top-0.5 h-8 w-8 text-zinc-400" />
        </div>
        <p className="mb-1 text-sm">Start a conversation with your Companion</p>
        <p className="text-xs text-gray-400">
          Ask about Memory, Plan to-dos, Forecast, or Brief — or attach a file
        </p>
      </div>
    );
  }

  return (
    <>
      <Portal.Slot id="tertiary-navigation">
        <ChatSidebar
          threads={threads}
          loading={loading}
          selectedThreadId={resolvedThreadId.current}
          onSelectThread={handleSelectThread}
          onNewThread={navigateToChatList}
          onDeleteThread={handleDeleteThread}
          onRefresh={refetchThreads}
        />
      </Portal.Slot>

      <div className="flex flex-col h-full">
        <Chat
          key={initialThreadId ?? `new-thread-${newThreadCount}`}
          loading={loading}
          streaming={chatRequestStreaming}
          hasStartedReceiving={hasStartedReceiving}
          disabled={isSubmitDisabled}
          placeholder={inputPlaceholder}
          initialDraft={chatDraft}
          messages={initialMessages}
          emptyState={emptyState}
          readable={stream ?? undefined}
          onSubmit={handleSubmit}
          onStop={stopChatRequest}
          autoFocus={true}
          onResponseFinished={handleResponseFinished}
        />
      </div>
    </>
  );
}

export default function ChatPage() {
  usePageTitle('Chat - Companion Intelligence');

  return <ChatPageContent />;
}
