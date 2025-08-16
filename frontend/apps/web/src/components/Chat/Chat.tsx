import { type ComponentProps, type ReactNode } from 'react';

import { ChatInput } from './ChatInput';
import { ChatLoader } from './ChatLoader';

type ChatInputProps = ComponentProps<typeof ChatInput>;

interface Props extends ChatInputProps {
  children: ReactNode;
}

export function Chat({ children, loading, ...chatInputProps }: Props) {
  return (
    <div className="flex flex-col h-full min-h-0 relative">
      <div
        className="
          flex-1 min-h-0 overflow-y-scroll p-4
          [mask-image:linear-gradient(to_top,transparent,hsl(0_0%_100%)_2rem)]
          [mask-repeat:no-repeat] [mask-size:100%_100%]
          [-webkit-mask-image:linear-gradient(to_top,transparent,hsl(0_0%_100%)_2rem)]
          [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:100%_100%]
        "
      >
        {children}
      </div>

      <div className="p-4 pt-4 pl-1 w-full relative">
        {loading && <ChatLoader />}

        <ChatInput loading={loading} {...chatInputProps} />
      </div>
    </div>
  );
}
