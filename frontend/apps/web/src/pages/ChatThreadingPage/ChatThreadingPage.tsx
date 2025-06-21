import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb, Button, Card, Textarea, cn } from '@ci/shadcn';

import { useAuth } from '@/hooks';

export function ChatThreadingPage() {
  usePageTitle('Chat - Companion Intelligence');

  const [{ authToken }] = useAuth();

  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const isNew = !id; // we're on /chat/new

  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isNew && threadId) {
      navigate(`/chat/${threadId}`, {
        replace: true,
      });
    }
  }, [isNew, threadId, navigate]);

  const handleSubmit = async () => {
    if (!input.trim()) return;

    setOutput('');
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/llm/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          prompt: input,
          threadId,
        }),
        signal: controller.signal,
      });

      setThreadId(res.headers.get('X-Thread-Id') as string);

      if (!res.body) throw new Error('No response body');

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          setOutput((prev) => prev + value);
        }
      }
    } catch (err) {
      if ((err as any).name !== 'AbortError') {
        console.error('Stream error:', err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  };

  useEffect(() => {
    containerRef.current?.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [output]);

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item className={cn(threadId && 'hidden md:block')}>
              <Breadcrumb.Link href="/chat/list">Chat</Breadcrumb.Link>
            </Breadcrumb.Item>
            {threadId && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />
                <Breadcrumb.Item>
                  <Breadcrumb.Page>{threadId}</Breadcrumb.Page>
                </Breadcrumb.Item>
              </>
            )}
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <Card className="w-full max-w-2xl mx-auto p-4 space-y-4">
        <Textarea
          placeholder="Enter your prompt..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="resize-none"
        />

        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={isLoading}>
            Generate
          </Button>
          <Button variant="destructive" onClick={handleStop} disabled={!isLoading}>
            Stop
          </Button>
        </div>

        <Card.Content
          ref={containerRef}
          className="whitespace-pre-wrap text-sm bg-muted rounded-lg p-4 max-h-96 overflow-y-auto font-mono"
        >
          {output || (isLoading ? 'Generating...' : 'Response will appear here.')}
        </Card.Content>
      </Card>
    </>
  );
}
