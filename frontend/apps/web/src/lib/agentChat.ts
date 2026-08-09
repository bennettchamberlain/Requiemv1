import type { NavigateFunction } from 'react-router-dom';

export interface AgentChatContext {
  title: string;
  body?: string | null;
  sourceKind?: string;
  sourceId?: string;
}

const SESSION_KEY = 'ci.agentChat.seed';

/** Persist context for ChatPage to pick up after navigation. */
export function stashAgentChatContext(context: AgentChatContext): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(context));
}

export function readAgentChatContext(): AgentChatContext | null {
  const raw = sessionStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AgentChatContext;
  } catch {
    return null;
  }
}

export function clearAgentChatContext(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function openInAppChat(navigate: NavigateFunction, context: AgentChatContext): void {
  stashAgentChatContext(context);
  navigate('/chat');
}

/** Open a Hub-managed agent harness in a new tab with optional context query params. */
export function openAgentHarness(openUrl: string, context: AgentChatContext): void {
  const url = new URL(openUrl);

  url.searchParams.set('title', context.title);

  if (context.body) {
    url.searchParams.set('context', context.body.slice(0, 2000));
  }

  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

/** @deprecated Use {@link openAgentHarness} with a discovered harness URL. */
export function openAgentApp(app: 'openclaw' | 'hermes', context: AgentChatContext): void {
  const params = new URLSearchParams({
    title: context.title,
    ...(context.body ? { context: context.body.slice(0, 2000) } : {}),
  });

  const path = app === 'openclaw' ? '/connect/openclaw' : '/connect/hermes';
  window.open(`${path}?${params.toString()}`, '_blank', 'noopener,noreferrer');
}
