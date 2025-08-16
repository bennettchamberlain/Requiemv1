import React, { type MouseEvent, type MouseEventHandler, type ReactNode, useCallback, useState } from 'react';

import { Badge, Button, cn } from '@ci/shadcn';
import { MessagesSquare, ThumbsDown, ThumbsUp } from '@ci/shadcn/icons';

import { ChatInput } from '../Chat/ChatInput';

// Constants
const CARD_WIDTH = '550px';
const CARD_HEIGHT = '500px';
const RIGHT_SECTION_WIDTH = 'w-50';

// Grouped interfaces
interface ChatProps {
  onSubmit?: (message: string) => void;
  onAttach?: (e: MouseEvent<HTMLButtonElement>) => void;
  onRecord?: (e: MouseEvent<HTMLButtonElement>) => void;
  onStop?: (e: MouseEvent<HTMLButtonElement>) => void;
  loading?: boolean;
  disabled?: boolean;
}

interface ActionProps {
  onLike?: MouseEventHandler;
  onDislike?: MouseEventHandler;
  onExpand?: MouseEventHandler;
}

interface Props {
  title: string;
  description: ReactNode;
  tags?: string[];
  imageUrl?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: MouseEventHandler;
  actions: ActionProps;
  chat?: ChatProps;
}

// Extracted components
const ActionButtons = ({ onLike, onDislike }: Pick<ActionProps, 'onLike' | 'onDislike'>) => (
  <div className="flex flex-row gap-2 content-between">
    <Button className="bg-stone-50 cursor-pointer" variant="outline" size="icon" onClick={onLike}>
      <ThumbsUp />
    </Button>

    <Button className="bg-stone-50 cursor-pointer" variant="outline" size="icon" onClick={onDislike}>
      <ThumbsDown />
    </Button>
  </div>
);

const ChatButton = ({ onExpand }: Pick<ActionProps, 'onExpand'>) => (
  <Button className="bg-stone-50 cursor-pointer" size="icon" variant="outline" onClick={onExpand}>
    <MessagesSquare />
  </Button>
);

const TagsSection = ({ tags }: { tags: string[] }) => (
  <div className="flex flex-wrap gap-1 justify-end mb-2">
    {tags.map((tag) => (
      <Badge key={tag} className="bg-teal-600">
        {tag}
      </Badge>
    ))}
  </div>
);

const ChatSection = ({ chat, className }: { chat?: ChatProps; className?: string }) => {
  if (!chat) {
    return null;
  }

  const handleChatSubmit = useCallback(
    (data: { message: string }) => {
      chat.onSubmit?.(data.message);
    },
    [chat.onSubmit],
  );

  return (
    <div className={cn('py-2 border-t', className)} onClick={(e) => e.stopPropagation()}>
      <ChatInput
        placeholder="Ask about this content..."
        disabled={chat.disabled}
        loading={chat.loading}
        onSubmit={handleChatSubmit}
        onAttach={chat.onAttach}
        onRecord={chat.onRecord}
        onStop={chat.onStop}
      />
    </div>
  );
};

export function BentoCard({
  title,
  tags = [],
  description,
  imageUrl,
  className,
  style,
  onClick,
  actions,
  chat,
}: Props) {
  const [imageError, setImageError] = useState(false);

  const handleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      onClick?.(e);
    },
    [onClick],
  );

  const handleLike = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      actions.onLike?.(e);
    },
    [actions.onLike],
  );

  const handleDislike = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      actions.onDislike?.(e);
    },
    [actions.onDislike],
  );

  const handleExpand = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      actions.onExpand?.(e);
    },
    [actions.onExpand],
  );

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  // Card without image layout
  if (imageUrl == null) {
    return (
      <div
        className={cn(
          `w-[${CARD_WIDTH}] h-[${CARD_HEIGHT}] flex flex-col border shadow-md rounded-lg cursor-pointer select-none`,
          className,
        )}
        style={style}
        onClick={handleClick}
      >
        <div className="flex flex-row flex-1">
          <div className="flex flex-col flex-1 gap-4 justify-between p-4">
            <div className="flex w-full justify-between content-start">
              <h1 className="text-2xl font-semibold">{title}</h1>
            </div>

            <div className="flex-1 overflow-hidden">
              <div>{description}</div>
            </div>

            <div className="flex gap-4 justify-between">
              <ActionButtons onLike={handleLike} onDislike={handleDislike} />
            </div>
          </div>

          <div
            className={`flex flex-col ${RIGHT_SECTION_WIDTH} justify-between content-end text-right relative p-4 bg-gray-50 rounded-tr-lg rounded-br-lg`}
          >
            {tags.length > 0 && <TagsSection tags={tags} />}

            <div className="flex justify-end pr-1">
              <ChatButton onExpand={handleExpand} />
            </div>
          </div>
        </div>

        <ChatSection chat={chat} className="px-4" />
      </div>
    );
  }

  // Card with image layout
  return (
    <div
      className={cn(
        `w-[${CARD_WIDTH}] h-[${CARD_HEIGHT}] flex flex-row border shadow-md rounded-lg cursor-pointer select-none`,
        className,
      )}
      style={style}
      onClick={handleClick}
    >
      <div className="flex flex-col flex-1 gap-4 justify-between p-4">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
        </div>

        <div className="flex-1 overflow-hidden">
          <div>{description}</div>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <ActionButtons onLike={handleLike} onDislike={handleDislike} />
          </div>
        </div>

        <ChatSection chat={chat} />
      </div>

      <div
        className={`flex flex-col ${RIGHT_SECTION_WIDTH} justify-between content-end text-right relative overflow-hidden rounded-tr-lg rounded-br-lg select-none`}
      >
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-end relative z-10 p-4 [background-image:radial-gradient(circle_at_top_right,_rgba(255,255,255,0.9),_rgba(255,255,255,0.1))]">
            <TagsSection tags={tags} />
          </div>
        )}

        <div className="relative z-10 text-right justify-end p-4">
          <ChatButton onExpand={handleExpand} />
        </div>

        {!imageError && (
          <img
            className="absolute inset-0 h-full w-auto object-cover overflow-hidden will-change-transform"
            src={imageUrl}
            onError={handleImageError}
            alt={title}
          />
        )}
      </div>
    </div>
  );
}
