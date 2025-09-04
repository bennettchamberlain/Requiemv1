import { SendHorizonal } from '@ci/shadcn/icons';

import { Markdown } from '@/components/Markdown';

interface Props {
  content: string;
}

export function UserMessage({ content }: Props) {
  return (
    <div className="relative self-end max-w-[40%] rounded-xl rounded-br-none px-4 py-3 shadow-sm bg-gradient-to-br from-primary to-primary/90 text-primary-foreground">
      <div className="prose-invert dark:prose max-w-none">
        <Markdown>{content}</Markdown>
      </div>

      <div className="absolute -bottom-2 -right-2 p-1 rounded-full bg-gradient-to-br from-gray-400 to-gray-400">
        <SendHorizonal className="h-4 w-4 text-primary-foreground z-10 -rotate-120" />
      </div>
    </div>
  );
}
