import { Card, Tooltip, cn } from '@ci/shadcn';
import { Clock, User, Mail, Send, Inbox } from '@ci/shadcn/icons';
import DOMPurify from 'dompurify';
import parse from 'html-react-parser';
import { gql } from '@/graphql';
import { useSearchParams } from 'react-router-dom';

import type { ParticipantData } from '../../types';
import { useMemoryServiceNext } from '../../useMemoryServiceNext';

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

interface Props {
  memory: FragmentType<typeof COMMUNICATION_FRAGMENT>;
}

export const COMMUNICATION_FRAGMENT = gql(`
  fragment TimelineCommunicationCardData on CommunicationType {
    id
    subject
    preview
    communicationContent: content
    time
    type
    direction
    from {
      id
      name
    }
    to {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`);

export function CommunicationCard({ memory }: Props) {
  const [searchParams] = useSearchParams();
  const { setActiveMemory } = useMemoryServiceNext({
    searchQuery: searchParams.get('search') || '',
    excludeTypes: searchParams.get('excludedEntityTypes')?.split(',') || [],
  });
  const communicationType = memory.type as string | undefined;
  const direction = memory.direction as string | undefined;
  const participantsMetadata = memory.participantsMetadata as
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
      return <Send className="h-6 w-6 flex-shrink-0 mt-1 text-[var(--primary)]" />;
    } else if (direction === 'received' || direction === 'inbound') {
      return <Inbox className="h-6 w-6 flex-shrink-0 mt-1 text-[var(--accent)]" />;
    }

    return <Mail className="h-6 w-6 flex-shrink-0 mt-1 text-[var(--accent-foreground)]" />;
  };

  const handleClick = () => {
    setActiveMemory(memory);
  };

  return (
    <Card
      className="!gap-2 !py-4 px-6 cursor-pointer hover:shadow-lg transition-shadow duration-200"
      onClick={handleClick}
    >
      <div className="flex items-start gap-3">
        {getDirectionIcon()}
        <div className="flex-1 min-w-0">
          <Tooltip>
            <Tooltip.Trigger asChild>
              <h3 className="text-lg font-semibold text-card-foreground truncate cursor-default">
                {memory.subject || `${(memory.type[0].toUpperCase()) + memory.type.slice(1)} Communication`}
              </h3>
            </Tooltip.Trigger>
            <Tooltip.Content>
              <p>{memory.subject || `${(memory.type[0].toUpperCase()) + memory.type.slice(1)} Communication`}</p>
            </Tooltip.Content>
          </Tooltip>
          <div className="flex items-center gap-2 flex-wrap">
            {communicationType && (
              <>
                <span className="text-sm text-muted-foreground capitalize">{communicationType}</span>
              </>
            )}
            {direction && (
              <>
                <span className="text-muted-foreground">•</span>
                <span
                  className={cn(
                    'text-sm font-medium',
                    direction === 'sent' || direction === 'outbound'
                      ? 'text-[var(--primary)]'
                      : 'text-[var(--accent)]',
                  )}
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
          <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-medium text-muted-foreground">{participantInfo.label}:</span>
            <span className="ml-2 text-sm text-card-foreground">{participantInfo.value}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-5">
        <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm text-card-foreground">
          {new Date(memory.time).toLocaleString('en-US', DATE_FORMAT_OPTIONS)}
        </span>
      </div>

      {memory.communicationContent &&
        parse(
          DOMPurify.sanitize(
            memory.communicationContent.length > 1000
              ? `${memory.communicationContent.substring(0, 1000)}...`
              : memory.communicationContent,
            { USE_PROFILES: { html: true } },
          ),
        )}

      {/*{memory.tags.length > 0 && (*/}
      {/*  <div className="flex flex-wrap gap-2 pt-2">*/}
      {/*    {memory.tags.map((tag, index) => (*/}
      {/*      <Tag key={index} text={tag} />*/}
      {/*    ))}*/}
      {/*  </div>*/}
      {/*)}*/}
    </Card>
  );
}
