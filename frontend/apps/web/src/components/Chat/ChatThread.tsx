import { ChatMessage } from './ChatMessage';

interface Message {
  role: string;
  content: string;
}

interface Props {
  messages?: Message[];
}

export function ChatThread({ messages }: Props) {
  if (messages == null) {
    return null;
  }

  return (
    <>
      {messages.map((message) => (
        <ChatMessage {...message} />
      ))}
    </>
  );
}
