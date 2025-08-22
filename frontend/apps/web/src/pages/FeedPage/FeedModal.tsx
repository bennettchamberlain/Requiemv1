import { type ReactNode, useCallback } from 'react';

import { Button, Dialog } from '@ci/shadcn';
import { Send } from '@ci/shadcn/icons';

import { Chat } from '@/components/Chat';
import { Tag } from '@/components/Tag';

interface Props {
  open?: boolean;
  title?: string;
  description?: ReactNode;
  tags?: string[];
  imageUrl?: string;
  onClose?: () => void;
}

export function FeedModal({ open = false, title, description, tags, imageUrl, onClose }: Props) {
  if (!title && !description) {
    return null;
  }

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      onClose?.();
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content className="sm:max-w-[70vw] h-[70vh] p-0 flex flex-col gap-0">
        <Dialog.Header className="flex flex-row items-center gap-4 p-4 pb-3 border-b">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description className="hidden">
            Interact with an action suggested by your AI agent
          </Dialog.Description>

          {tags && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Tag key={tag} text={tag} />
              ))}
            </div>
          )}
        </Dialog.Header>

        <div className="flex flex-1">
          <div className="flex flex-col gap-4 p-4 border-r">
            {imageUrl && (
              <div className="aspect-video rounded-lg overflow-hidden bg-gray-100">
                <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
              </div>
            )}

            <div className="flex-1">{description}</div>

            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-2">Quick Actions</h3>
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

          <Chat
            placeholder="Ask about this content..."
            emptyState={
              <div className="text-center text-gray-500 mt-8">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                  <Send className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-sm">Start a conversation about this content</p>
                <p className="text-xs text-gray-400 mt-1">
                  Ask questions, get recommendations, or explore ideas
                </p>
              </div>
            }
          />
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
