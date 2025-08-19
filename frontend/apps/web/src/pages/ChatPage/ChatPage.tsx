import { useState, useRef, useCallback, type FormEvent, type ReactNode } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, Card } from '@ci/shadcn';
import { RefreshCw, MessageSquare, X } from '@ci/shadcn/icons';
import { useLocation, useNavigate } from 'react-router-dom';

import { Chat, type FormData } from '@/components/Chat';
import { ModelSelector } from '@/components/ModelSelector';
import { useAuth, useModel } from '@/hooks';

import { ChatSidebar } from './ChatSidebar';
import { useThreadListService } from './useThreadListService';
import { useThreadService } from './useThreadService';

export default function ChatPage() {
  usePageTitle('Chat - Companion Intelligence');

  const navigate = useNavigate();
  const location = useLocation();

  // Extract route information from pathname instead of useParams
  // This needs to happen because this page handles /chat and /chat/:id
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const threadId = pathSegments.length > 1 ? pathSegments[1] : null;

  const [{ selectedModel }] = useModel();

  const [
    { threads, loading: threadsLoading, error: threadsError },
    { refetch: refetchThreads, delete: handleDeleteThread },
  ] = useThreadListService();

  const [{ thread, loading: threadLoading }] = useThreadService(threadId);

  const [
    { stream, loading: chatRequestLoading, streaming: chatRequestStreaming, threadId: chatRequestThreadId },
    { submit: submitChatRequest, stop: stopChatRequest },
  ] = useChatRequester(threadId);

  const handleCreateThread = useCallback(() => {
    // Note: Thread will be created automatically when the first message is sent
    navigate('/chat');
  }, [navigate]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      navigate(`/chat/${threadId}`);
    },
    [navigate],
  );

  // Handle form submission
  const handleSubmit = useCallback(
    async (data: FormData, e?: FormEvent) => {
      e?.preventDefault();

      return submitChatRequest(data);
    },
    [submitChatRequest],
  );

  const loading = threadsLoading || threadLoading || chatRequestLoading || chatRequestStreaming;
  const isSubmitDisabled = loading || selectedModel == null;
  const inputPlaceholder =
    chatRequestThreadId == null ? 'Start a new conversation...' : 'Continue the conversation...';

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
  } else if (threadId == null) {
    emptyState = (
      <div className="text-center max-w-md mx-auto mb-6 lg:mb-8">
        <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-full bg-gradient-to-br from-primary/10 to-primary/20 flex items-center justify-center mx-auto mb-4 lg:mb-6 shadow-lg border border-primary/20">
          <MessageSquare className="h-8 w-8 lg:h-10 lg:w-10 text-primary" />
        </div>
        <h2 className="text-xl lg:text-2xl font-semibold mb-3 bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
          Welcome to Chat
        </h2>
        <p className="text-muted-foreground mb-4 lg:mb-6 leading-relaxed text-sm lg:text-base">
          Choose a thread from the sidebar or create a new one to start chatting with AI
        </p>
      </div>
    );
  }

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Link href="/chat">Chat</Breadcrumb.Link>
            </Breadcrumb.Item>
            {threadId && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />
                <Breadcrumb.Item>
                  <Breadcrumb.Page>{thread?.name || thread?.id.slice(0, 8)}</Breadcrumb.Page>
                </Breadcrumb.Item>
              </>
            )}
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <Portal.Slot id="actions">
        <ModelSelector />
      </Portal.Slot>

      <Portal.Slot id="tertiary-navigation">
        <ChatSidebar
          threads={threads}
          loading={loading}
          selectedThreadId={threadId}
          onSelectThread={handleSelectThread}
          onNewThread={handleCreateThread}
          onDeleteThread={handleDeleteThread}
          onRefresh={refetchThreads}
        />
      </Portal.Slot>

      <Chat
        // key={threadId ?? ''}
        loading={loading}
        disabled={isSubmitDisabled}
        placeholder={inputPlaceholder}
        messages={thread?.messages}
        emptyState={emptyState}
        readable={stream ?? undefined}
        onSubmit={handleSubmit}
        onStop={stopChatRequest}
      />
    </>
  );
}

type ReturnType = [
  {
    stream: ReadableStream<Uint8Array> | null;
    loading: boolean;
    error: unknown | null;
    streaming: boolean;
    threadId: string | null;
  },
  {
    submit: (data: FormData) => Promise<boolean>;
    stop: () => void;
  },
];

function useChatRequester(threadId: string | null): ReturnType {
  const [{ authToken }] = useAuth();
  const [{ selectedModel }] = useModel();

  const abortControllerRef = useRef<AbortController | null>(null);

  const [stream, setStream] = useState<ReadableStream<Uint8Array> | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<unknown | null>(null);
  const [streaming, setStreaming] = useState<boolean>(false);
  const [resThreadId, setResThreadId] = useState<string | null>(threadId);

  const submit = useCallback(
    async (data: FormData) => {
      if (!data.message.trim()) {
        return false;
      }

      abortControllerRef.current?.abort();

      const controller = new AbortController();

      abortControllerRef.current = controller;

      setStream(null);
      setLoading(true);
      setError(null);
      setStreaming(false);
      setResThreadId(null);

      let success = false;

      try {
        const res = await fetch('/api/llm/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            prompt: data.message.trim(),
            model: selectedModel,
            threadId: threadId,
            enableTools: true,
            enableThinking: true,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error('Request error');
        }

        if (!res.body) {
          throw new Error('No response body');
        }

        success = true;

        setResThreadId(res.headers.get('X-Thread-Id') as string);

        const monitor = new TransformStream({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
          flush(controller) {
            setStreaming(false);
            controller.terminate();
          },
        });

        const stream = res.body.pipeThrough(monitor);

        setStream(stream);
        setStreaming(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError(err);
        }
      } finally {
        setLoading(false);
      }

      return success;
    },
    [authToken, selectedModel, threadId],
  );

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    setStream(null);
    setStreaming(false);
  }, []);

  return [
    {
      stream,
      loading,
      error,
      streaming,
      threadId: resThreadId,
    },
    {
      submit,
      stop,
    },
  ];
}
