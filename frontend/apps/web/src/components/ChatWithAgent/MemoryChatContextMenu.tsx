import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useDeviceLayout } from '@ci/common';
import { Button, ContextMenu, Sheet, cn } from '@ci/shadcn';
import { useTranslation } from 'react-i18next';

import { entityToAgentChatContext } from '@/lib/entityToAgentChatContext';
import type { MemoryEntity } from '@/pages/MemoryPage/useEntityService';

import { useChatAboutActions } from './useChatAboutActions';

const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD_PX = 8;

interface MemoryChatAboutProps {
  entity: MemoryEntity;
  children: ReactNode;
  className?: string;
}

export function MemoryChatAbout({ entity, children, className }: MemoryChatAboutProps) {
  const { isMobile } = useDeviceLayout();
  const context = useMemo(() => entityToAgentChatContext(entity), [entity]);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (isMobile) {
    return (
      <MobileChatAbout
        contextTitle={context.title}
        entity={entity}
        className={className}
        sheetOpen={sheetOpen}
        onSheetOpenChange={setSheetOpen}
      >
        {children}
      </MobileChatAbout>
    );
  }

  return (
    <ContextMenu>
      <ContextMenu.Trigger asChild>
        <div className={className}>{children}</div>
      </ContextMenu.Trigger>
      <ContextMenu.Content className="z-[1100]">
        <ChatAboutContextItems entity={entity} />
      </ContextMenu.Content>
    </ContextMenu>
  );
}

function MobileChatAbout({
  entity,
  children,
  className,
  sheetOpen,
  onSheetOpenChange,
  contextTitle,
}: MemoryChatAboutProps & {
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  contextTitle: string;
}) {
  const { t } = useTranslation();
  const longPress = useLongPress(() => onSheetOpenChange(true));

  return (
    <>
      <div
        className={cn('select-none [-webkit-touch-callout:none]', className)}
        onPointerDown={longPress.onPointerDown}
        onPointerMove={longPress.onPointerMove}
        onPointerUp={longPress.onPointerUp}
        onPointerCancel={longPress.onPointerCancel}
        onClickCapture={longPress.onClickCapture}
        onContextMenu={(event) => {
          event.preventDefault();
          onSheetOpenChange(true);
        }}
      >
        {children}
      </div>
      <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
        <Sheet.Content side="bottom" className="z-[1100] rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Sheet.Header>
            <Sheet.Title>{t('CHAT_WITH_AGENT_ABOUT', { title: contextTitle })}</Sheet.Title>
            <Sheet.Description className="sr-only">{t('CHAT_WITH_AGENT_OPEN_MENU')}</Sheet.Description>
          </Sheet.Header>
          {sheetOpen ? (
            <div className="flex flex-col gap-1 px-4 pb-4">
              <ChatAboutSheetItems entity={entity} onAction={() => onSheetOpenChange(false)} />
            </div>
          ) : null}
        </Sheet.Content>
      </Sheet>
    </>
  );
}

function ChatAboutContextItems({ entity }: { entity: MemoryEntity }) {
  const { t } = useTranslation();
  const context = useMemo(() => entityToAgentChatContext(entity), [entity]);
  const { chatHere, chatableHarnesses, openHarness } = useChatAboutActions(context);

  return (
    <>
      <ContextMenu.Item onSelect={chatHere}>{t('CHAT_WITH_AGENT_HERE')}</ContextMenu.Item>
      {chatableHarnesses.map((harness) => (
        <ContextMenu.Item key={harness.id} onSelect={() => openHarness(harness)}>
          {t('CHAT_WITH_AGENT_OPEN_IN', { name: harness.name })}
        </ContextMenu.Item>
      ))}
    </>
  );
}

function ChatAboutSheetItems({ entity, onAction }: { entity: MemoryEntity; onAction: () => void }) {
  const { t } = useTranslation();
  const context = useMemo(() => entityToAgentChatContext(entity), [entity]);
  const { chatHere, chatableHarnesses, openHarness } = useChatAboutActions(context);

  return (
    <>
      <Button
        variant="ghost"
        className="h-11 justify-start"
        onClick={() => {
          chatHere();
          onAction();
        }}
      >
        {t('CHAT_WITH_AGENT_HERE')}
      </Button>
      {chatableHarnesses.map((harness) => (
        <Button
          key={harness.id}
          variant="ghost"
          className="h-11 justify-start"
          onClick={() => {
            openHarness(harness);
            onAction();
          }}
        >
          {t('CHAT_WITH_AGENT_OPEN_IN', { name: harness.name })}
        </Button>
      ))}
    </>
  );
}

function useLongPress(onLongPress: () => void) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.pointerType === 'mouse') {
        return;
      }

      firedRef.current = false;
      startRef.current = { x: event.clientX, y: event.clientY };
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        firedRef.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [clearTimer, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!startRef.current) {
        return;
      }

      const dx = event.clientX - startRef.current.x;
      const dy = event.clientY - startRef.current.y;
      if (dx * dx + dy * dy > MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX) {
        clearTimer();
      }
    },
    [clearTimer],
  );

  const onPointerUp = useCallback(() => {
    clearTimer();
    startRef.current = null;
  }, [clearTimer]);

  const onClickCapture = useCallback((event: ReactMouseEvent) => {
    if (firedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      firedRef.current = false;
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onClickCapture,
  };
}
