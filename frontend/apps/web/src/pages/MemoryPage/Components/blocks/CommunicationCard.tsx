import { Card, Tooltip } from '@ci/shadcn';
import { Clock, User, Mail, Send, Inbox } from '@ci/shadcn/icons';

import { RelationshipsSection } from '../RelationshipsSection';
import type { MemoryCardProps, ParticipantData } from '../types';

export function CommunicationCard({ memory }: MemoryCardProps) {
  const communicationType = memory.metadata?.communicationType as string | undefined;
  const direction = memory.metadata?.direction as string | undefined;
  const participantsMetadata = memory.metadata?.participantsMetadata as
    | Record<string, ParticipantData[]>
    | undefined;

  const getParticipantInfo = () => {
    if (!participantsMetadata) {
      return null;
    }

    if (direction === 'received' || direction === 'inbound') {
      const fromParticipants = participantsMetadata.from || participantsMetadata.sender;
      if (Array.isArray(fromParticipants) && fromParticipants.length > 0) {
        const fromPerson = fromParticipants[0];
        const name = fromPerson.name || fromPerson.email;
        if (name) {
          return { label: 'From', value: name };
        }
      }
    }

    if (direction === 'sent' || direction === 'outbound') {
      const toParticipants = participantsMetadata.to || participantsMetadata.recipients;
      if (Array.isArray(toParticipants) && toParticipants.length > 0) {
        const names = toParticipants.map((p: ParticipantData) => p.name || p.email).filter(Boolean);
        if (names.length > 0) {
          const displayValue =
            names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ');

          return { label: 'To', value: displayValue };
        }
      }
    }

    return null;
  };

  const participantInfo = getParticipantInfo();

  const getDirectionIcon = () => {
    if (direction === 'sent' || direction === 'outbound') {
      return <Send className="h-6 w-6 text-blue-600 flex-shrink-0 mt-1" />;
    } else if (direction === 'received' || direction === 'inbound') {
      return <Inbox className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />;
    }

    return <Mail className="h-6 w-6 text-indigo-600 flex-shrink-0 mt-1" />;
  };

  return (
    <Card className="!gap-2 !py-4 px-6">
      <div className="flex items-start gap-3">
        {getDirectionIcon()}
        <div className="flex-1 min-w-0">
          <Tooltip>
            <Tooltip.Trigger asChild>
              <h3 className="text-lg font-semibold text-gray-900 truncate cursor-default">{memory.title}</h3>
            </Tooltip.Trigger>
            <Tooltip.Content>
              <p>{memory.title}</p>
            </Tooltip.Content>
          </Tooltip>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-gray-600">{memory.category}</p>
            {communicationType && (
              <>
                <span className="text-gray-400">•</span>
                <span className="text-sm text-gray-600 capitalize">{communicationType}</span>
              </>
            )}
            {direction && (
              <>
                <span className="text-gray-400">•</span>
                <span
                  className={`text-sm font-medium ${
                    direction === 'sent' || direction === 'outbound' ? 'text-blue-600' : 'text-green-600'
                  }`}
                >
                  {direction === 'sent' || direction === 'outbound' ? 'Sent' : 'Received'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {participantInfo && (
        <div className="flex items-center gap-5">
          <User className="h-4 w-4 text-gray-500 flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-medium text-gray-700">{participantInfo.label}:</span>
            <span className="ml-2 text-sm text-gray-900">{participantInfo.value}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-5">
        <Clock className="h-4 w-4 text-gray-500 flex-shrink-0" />
        <span className="text-sm text-gray-900">
          {new Date(memory.timestamp).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })}
        </span>
      </div>

      {memory.description && (
        <div className="pt-3 pb-3">
          <p className="text-sm text-gray-700 leading-relaxed">{memory.description}</p>
        </div>
      )}

      {memory.tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {memory.tags.map((tag, index) => (
            <span key={index} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}

      <RelationshipsSection relationships={memory.metadata?.relationships} />
    </Card>
  );
}
