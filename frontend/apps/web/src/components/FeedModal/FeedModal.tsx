import React, { useCallback, useEffect, useState, useRef } from 'react';

import { Button, cn } from '@ci/shadcn';
import { X, Send, ThumbsUp, ThumbsDown, Bot } from '@ci/shadcn/icons';
import { createPortal } from 'react-dom';

import { useAuth, useModel } from '../../hooks';
import { ChatInput, type FormData } from '../Chat/ChatInput';
import { ParsedChatContent } from '../ChatBlocks/ParsedChatContent';

// Custom scrollbar styles
const scrollbarStyles = `
  .chat-scrollbar::-webkit-scrollbar {
    width: 6px;
  }

  .chat-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }

  .chat-scrollbar::-webkit-scrollbar-thumb {
    background: hsl(var(--muted-foreground) / 0.2);
    border-radius: 3px;
  }

  .chat-scrollbar::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.3);
  }
`;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface FeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: FeedItem | null;
  className?: string;
  onLike?: (itemId: string) => void;
  onDislike?: (itemId: string) => void;
}

interface FeedItem {
  id: string;
  title: string;
  description: React.ReactNode;
  tags: string[];
  imageUrl?: string;
}

export function FeedModal({ isOpen, onClose, item, className, onLike, onDislike }: FeedModalProps) {
  const [{ authToken }] = useAuth();
  const [{ selectedModel }] = useModel();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [isVisible, setIsVisible] = useState(false);
  const [output, setOutput] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Add custom scrollbar styles
  useEffect(() => {
    const styleElement = document.createElement('style');
    styleElement.textContent = scrollbarStyles;
    document.head.appendChild(styleElement);

    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);

  // Create a new thread for the feed item by sending initial context
  const createThreadForItem = useCallback(async () => {
    if (!item || !authToken) {
      return;
    }

    try {
      setLoadingThread(true);

      // Create initial context message about the feed item
      const contextMessage = `I'm looking at this content: ${item.title}. ${item.description ? 'Description: ' + (typeof item.description === 'string' ? item.description : 'See details in the left panel.') : ''}`;

      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: contextMessage,
        timestamp: new Date(),
      };

      setMessages([userMessage]);

      // Send the initial context to create a thread
      const controller = new AbortController();

      const res = await fetch('/api/llm/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          prompt: contextMessage,
          model: selectedModel,
          enableTools: true,
        }),
        signal: controller.signal,
      });

      const newThreadId = res.headers.get('X-Thread-Id') as string;
      if (newThreadId) {
        setThreadId(newThreadId);
      }

      if (!res.body) {
        throw new Error('No response body');
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();

      let assistantResponse = '';
      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        if (value) {
          assistantResponse += value;
        }
      }

      // Add the assistant's response to chat history
      if (assistantResponse.trim()) {
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: assistantResponse,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error('Failed to create thread:', error);
    } finally {
      setLoadingThread(false);
    }
  }, [item, authToken, selectedModel]);

  // Reset messages when item changes
  useEffect(() => {
    if (item) {
      setMessages([]);
      setOutput('');
      setThreadId(null);
      // Create a new thread for this feed item
      createThreadForItem();
    }
  }, [item, createThreadForItem]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages, output]);

  // Handle animation when modal opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to trigger the animation
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 10);

      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsVisible(false);
        // Delay the actual close to allow animation to complete
        setTimeout(() => {
          onClose();
        }, 300);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const handleChatSubmit = useCallback(
    async (data: FormData, e?: React.FormEvent) => {
      e?.preventDefault();

      if (!data.message.trim() || !item || !authToken) {
        return;
      }

      // Add user message to chat history immediately
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: data.message.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
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
            prompt: data.message.trim(),
            model: selectedModel,
            threadId: threadId || undefined,
            enableTools: true,
          }),
          signal: controller.signal,
        });

        const newThreadId = res.headers.get('X-Thread-Id') as string;
        if (newThreadId && !threadId) {
          setThreadId(newThreadId);
        }

        if (!res.body) {
          throw new Error('No response body');
        }

        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();

        let assistantResponse = '';
        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          if (value) {
            assistantResponse += value;
            setOutput(assistantResponse);
            console.log('Streaming response:', assistantResponse);
          }
        }

        // Add the assistant's response to chat history
        if (assistantResponse.trim()) {
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: assistantResponse,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Stream error:', err);
        }
      } finally {
        setOutput('');
        setIsLoading(false);
      }
    },
    [authToken, selectedModel, threadId, item],
  );

  const handleAttach = useCallback(() => {
    console.log('Attach file');
    // Handle file attachment
  }, []);

  const handleRecord = useCallback(() => {
    console.log('Start recording');
    // Handle voice recording start
  }, []);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        setIsVisible(false);
        // Delay the actual close to allow animation to complete
        setTimeout(() => {
          onClose();
        }, 300);
      }
    },
    [onClose],
  );

  if (!isOpen || !item) {
    return null;
  }

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm transition-all duration-300 p-4',
        isVisible ? 'bg-black/50' : 'bg-black/0',
      )}
      onClick={handleBackdropClick}
    >
      <div
        className={cn(
          'relative w-full max-w-5xl h-[85vh] bg-white rounded-lg shadow-2xl transform transition-all duration-300 ease-out overflow-hidden flex flex-col',
          isVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4',
          className,
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-gray-900">{item.title}</h2>
              <div className="flex flex-wrap gap-2 mt-2">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 text-xs font-medium bg-teal-100 text-teal-800 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Action Buttons */}
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 bg-stone-50 cursor-pointer hover:bg-stone-100"
              onClick={() => onLike?.(item.id)}
            >
              <ThumbsUp className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 bg-stone-50 cursor-pointer hover:bg-stone-100"
              onClick={() => onDislike?.(item.id)}
            >
              <ThumbsDown className="h-4 w-4" />
            </Button>
            {/* Close Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setIsVisible(false);
                // Delay the actual close to allow animation to complete
                setTimeout(() => {
                  onClose();
                }, 300);
              }}
              className="h-8 w-8 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0">
          {/* Left Panel - Card Details */}
          <div className="w-1/2 flex flex-col border-r border-gray-200 min-h-0">
            <div className="flex-1 overflow-y-auto p-4 min-h-0">
              <div className="space-y-4">
                {/* Image */}
                {item.imageUrl && (
                  <div className="aspect-video rounded-lg overflow-hidden bg-gray-100">
                    <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                  </div>
                )}

                {/* Description */}
                <div className="prose prose-sm max-w-none">
                  <div className="text-gray-700">{item.description}</div>
                </div>

                {/* Additional Info */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Quick Actions</h3>
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      Save to favorites
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      Share with family
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      Add to calendar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel - Chat */}
          <div className="w-1/2 flex flex-col min-h-0">
            {/* Chat Messages */}
            <div
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-3 chat-scrollbar min-h-0"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: 'hsl(var(--muted-foreground) / 0.2) transparent',
              }}
            >
              {loadingThread ? (
                <div className="text-center py-12">
                  <div className="w-12 h-12 animate-spin mx-auto mb-4 text-primary/50">
                    <svg className="w-full h-full" fill="none" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                  </div>
                  <p className="text-muted-foreground font-medium">Creating chat thread...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center text-gray-500 mt-8">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <Send className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm">Start a conversation about this content</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Ask questions, get recommendations, or explore ideas
                  </p>
                </div>
              ) : (
                messages.map((message, index) => (
                  <div
                    key={message.id}
                    className={cn(
                      'flex gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300',
                      message.role === 'user' ? 'justify-end' : 'justify-start',
                    )}
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    {message.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/10 to-primary/20 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm border border-primary/20">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}

                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm transition-all duration-200 hover:shadow-md',
                        message.role === 'user'
                          ? 'bg-gradient-to-br from-primary to-primary/90 text-primary-foreground ml-auto shadow-md'
                          : 'bg-gradient-to-br from-muted to-muted/80 text-foreground border border-border/50 backdrop-blur-sm',
                      )}
                    >
                      {message.role === 'user' ? (
                        <div className="whitespace-pre-wrap">{message.content}</div>
                      ) : (
                        <ParsedChatContent content={message.content} />
                      )}
                      <div
                        className={cn(
                          'text-xs opacity-70 mt-2 text-right',
                          message.role === 'user' ? 'text-primary-foreground/80' : 'text-muted-foreground',
                        )}
                      >
                        {message.timestamp.toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>

                    {message.role === 'user' && (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/30 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm border border-primary/30">
                        <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-start animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shadow-sm">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="bg-muted text-foreground rounded-2xl px-4 py-3 text-sm border border-border/50 shadow-sm">
                      {output ? (
                        <div className="whitespace-pre-wrap">{output}</div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex space-x-1">
                            <div
                              className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
                              style={{ animationDelay: '0ms' }}
                            />
                            <div
                              className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
                              style={{ animationDelay: '150ms' }}
                            />
                            <div
                              className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
                              style={{ animationDelay: '300ms' }}
                            />
                          </div>
                          <span className="text-muted-foreground">Generating...</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="flex-shrink-0 p-3 border-t border-gray-200 bg-white">
              <ChatInput
                placeholder="Ask about this content..."
                disabled={isLoading || !selectedModel}
                loading={isLoading}
                onSubmit={handleChatSubmit}
                onAttach={handleAttach}
                onRecord={handleRecord}
                onStop={handleStop}
              />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
