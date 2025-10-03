import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/services';
import { EventService, ContentService } from '@ci/domains/memory';
import type { CreateEventDto, CreateContentDto } from '@ci/domains/memory/types';

import { PeoplePromotionService } from './PeoplePromotionService';

interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: Array<{
      name: string;
      value: string;
    }>;
    body?: {
      size?: number;
      data?: string;
    };
    parts?: Array<{
      mimeType?: string;
      body?: {
        size?: number;
        data?: string;
      };
    }>;
  };
  sizeEstimate?: number;
  historyId?: string;
  internalDate?: string;
}

interface EmailParticipant {
  email: string;
  name: string;
  type: 'from' | 'to' | 'cc' | 'bcc';
}

@Injectable()
export class GmailPromotionService {
  private logger = new LoggerService(GmailPromotionService.name);

  constructor(
    private readonly eventService: EventService,
    private readonly contentService: ContentService,
    private readonly peoplePromotionService: PeoplePromotionService,
  ) {}

  async promoteGmailMessages(apiLogContent: unknown, userId: string, connectionId: string): Promise<void> {
    this.logger.log('Starting Gmail message promotion', {
      userId,
      connectionId,
      contentType: typeof apiLogContent,
      contentKeys: apiLogContent && typeof apiLogContent === 'object' ? Object.keys(apiLogContent) : [],
    });

    try {
      // Extract messages from the API log content
      const messages = this.extractGmailMessages(apiLogContent);
      
      if (messages.length === 0) {
        this.logger.log('No Gmail messages found to promote', {
          userId,
          connectionId,
          apiLogContent: JSON.stringify(apiLogContent).substring(0, 200),
        });
        return;
      }

      this.logger.log(`Found ${messages.length} Gmail messages to process`, {
        userId,
        connectionId,
        messageIds: messages.map(m => m.id || 'no-id'),
        snippets: messages.map(m => (m.snippet || 'no-snippet').substring(0, 50)).slice(0, 5),
      });

      // Process each message
      let processedCount = 0;
      for (const message of messages) {
        await this.processGmailMessage(message, userId, connectionId);
        processedCount++;
        
        // Log progress every 10 messages
        if (processedCount % 10 === 0) {
          this.logger.log('Gmail message promotion progress', {
            userId,
            connectionId,
            processedCount,
            totalMessages: messages.length,
          });
        }
      }

      this.logger.log('Gmail message promotion completed', {
        userId,
        connectionId,
        totalMessages: messages.length,
        processedCount,
      });
    } catch (error) {
      this.logger.error('Error promoting Gmail messages', {
        userId,
        connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private extractGmailMessages(content: unknown): GmailMessage[] {
    if (!content || typeof content !== 'object') {
      this.logger.warn('Invalid content type for Gmail messages', {
        contentType: typeof content,
        contentNull: content === null,
      });
      return [];
    }

    const contentObj = content as Record<string, unknown>;
    
    // Handle the structure from Gmail API - messages array
    if ('messages' in contentObj && Array.isArray(contentObj.messages)) {
      this.logger.log('Extracting messages from messages array', {
        messageCount: contentObj.messages.length,
      });
      return contentObj.messages as GmailMessage[];
    }

    // Handle history format (incremental sync)
    if ('history' in contentObj && Array.isArray(contentObj.history)) {
      this.logger.log('Extracting messages from history array', {
        historyCount: contentObj.history.length,
      });
      const messages: GmailMessage[] = [];
      for (const historyItem of contentObj.history) {
        if (typeof historyItem === 'object' && historyItem !== null) {
          const history = historyItem as Record<string, unknown>;
          if (history.messages && Array.isArray(history.messages)) {
            messages.push(...(history.messages as GmailMessage[]));
          }
          if (history.messagesAdded && Array.isArray(history.messagesAdded)) {
            for (const added of history.messagesAdded) {
              if (typeof added === 'object' && added !== null && 'message' in added) {
                messages.push((added as any).message as GmailMessage);
              }
            }
          }
        }
      }
      return messages;
    }

    // Handle single message
    if ('id' in contentObj && 'payload' in contentObj) {
      this.logger.log('Extracting single message', {
        messageId: contentObj.id,
      });
      return [contentObj as GmailMessage];
    }

    this.logger.warn('No messages found in content', {
      contentKeys: Object.keys(contentObj),
    });
    return [];
  }

  private async processGmailMessage(message: GmailMessage, userId: string, connectionId: string): Promise<void> {
    try {
      // Extract message details
      const messageDetails = this.extractMessageDetails(message);
      
      // Enhanced logging with more details
      this.logger.log('');
      this.logger.log('##########################################################');
      this.logger.log('📧 GMAIL MESSAGE DETAILS (SAVING TO DATABASE)');
      this.logger.log('##########################################################');
      this.logger.log('Message ID: ' + messageDetails.id);
      this.logger.log('Subject: ' + messageDetails.subject);
      this.logger.log('From: ' + messageDetails.from);
      this.logger.log('To: ' + messageDetails.to.join(', '));
      this.logger.log('Date: ' + messageDetails.date);
      this.logger.log('Snippet: ' + messageDetails.snippet);
      this.logger.log('Labels: ' + messageDetails.labels.join(', '));
      this.logger.log('Has Body: ' + (messageDetails.body ? 'Yes' : 'No'));
      this.logger.log('');
      this.logger.log('PARTICIPANTS (' + messageDetails.participants.length + ' total):');
      messageDetails.participants.forEach((participant, index) => {
        this.logger.log(`  ${index + 1}. ${participant.name} (${participant.email}) - ${participant.type}`);
      });
      this.logger.log('##########################################################');
      this.logger.log('');

      // Transform to memory domain format
      const eventDto = this.transformToEventDto(messageDetails, message, userId, connectionId);
      
      // Save event using memory domain service
      const savedEvent = await this.eventService.create({ userId }, eventDto);
      const eventId = Array.isArray(savedEvent) ? savedEvent[0].id : savedEvent.id;

      // Save email body as content if available
      if (messageDetails.body) {
        const contentDto = this.transformToContentDto(messageDetails, eventId, userId);
        await this.contentService.create({ userId }, contentDto);
      }

      // Process participants to create people and contacts
      await this.peoplePromotionService.processParticipants(
        messageDetails.participants,
        userId,
        connectionId,
        'email',
      );

      this.logger.log('');
      this.logger.log('✅ EMAIL SAVED TO DATABASE SUCCESSFULLY');
      this.logger.log('');

    } catch (error) {
      this.logger.error('Error processing individual Gmail message', {
        userId,
        connectionId,
        messageId: message.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - continue processing other messages
    }
  }

  private transformToEventDto(
    messageDetails: ReturnType<typeof this.extractMessageDetails>,
    rawMessage: GmailMessage,
    userId: string,
    connectionId: string,
  ): CreateEventDto {
    // Build source data with all relevant information
    const sourceData = {
      ...rawMessage,
      connectionId,
      subject: messageDetails.subject,
      from: messageDetails.from,
      to: messageDetails.to,
      cc: messageDetails.cc,
      bcc: messageDetails.bcc,
      participants: messageDetails.participants,
      labels: messageDetails.labels,
      threadId: rawMessage.threadId,
    };

    const start_time = messageDetails.date ? new Date(messageDetails.date) : undefined;

    if(!start_time) {
      this.logger.error("Cannot find start time")
      throw "Cannot find start time"
    }

    // Create the event DTO
    const eventDto: CreateEventDto = {
      id: '', // Will be generated by the service
      name: messageDetails.subject || 'Untitled Email',
      type: 'email',
      description: messageDetails.snippet || "",
      start_time,
      external_id: messageDetails.id,
      source_url: `https://mail.google.com/mail/u/0/#all/${messageDetails.id}`,
      source_data: sourceData,
      user: { id: userId },
      connection_id: connectionId,
    };

    return eventDto;
  }

  private transformToContentDto(
    messageDetails: ReturnType<typeof this.extractMessageDetails>,
    eventId: string,
    userId: string,
  ): CreateContentDto {
    const contentDto: CreateContentDto = {
      id: '', // Will be generated by the service
      type: 'email_body',
      title: messageDetails.subject || 'Email Body',
      text: messageDetails.body || "",
      mimetype: 'text/plain', // Could be enhanced to detect HTML
      external_id: `${messageDetails.id}_body`,
      event_id: eventId,
      event: { id: eventId },
      user: { id: userId },
    };

    return contentDto;
  }

  private extractMessageDetails(message: GmailMessage) {
    // Extract headers
    const headers = message.payload?.headers || [];
    const getHeader = (name: string): string => {
      const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
      return header?.value || '';
    };

    const subject = getHeader('Subject') || 'No Subject';
    const from = getHeader('From');
    const to = getHeader('To');
    const cc = getHeader('Cc');
    const bcc = getHeader('Bcc');
    const date = getHeader('Date');

    // Extract participants
    const participants: EmailParticipant[] = [];
    
    // Parse From
    if (from) {
      const parsed = this.parseEmailAddress(from);
      participants.push({ ...parsed, type: 'from' });
    }

    // Parse To
    if (to) {
      const addresses = to.split(',').map(addr => addr.trim());
      for (const addr of addresses) {
        const parsed = this.parseEmailAddress(addr);
        participants.push({ ...parsed, type: 'to' });
      }
    }

    // Parse CC
    if (cc) {
      const addresses = cc.split(',').map(addr => addr.trim());
      for (const addr of addresses) {
        const parsed = this.parseEmailAddress(addr);
        participants.push({ ...parsed, type: 'cc' });
      }
    }

    // Parse BCC
    if (bcc) {
      const addresses = bcc.split(',').map(addr => addr.trim());
      for (const addr of addresses) {
        const parsed = this.parseEmailAddress(addr);
        participants.push({ ...parsed, type: 'bcc' });
      }
    }

    // Extract body
    let body: string | null = null;
    if (message.payload?.body?.data) {
      body = this.decodeBase64(message.payload.body.data);
    } else if (message.payload?.parts) {
      // Look for text/plain part first, then text/html
      const textPart = message.payload.parts.find(p => p.mimeType === 'text/plain');
      const htmlPart = message.payload.parts.find(p => p.mimeType === 'text/html');
      const part = textPart || htmlPart;
      
      if (part?.body?.data) {
        body = this.decodeBase64(part.body.data);
        // If it's HTML, we might want to strip tags in the future
        if (part.mimeType === 'text/html' && body) {
          // For now, just note it's HTML
          body = `[HTML Content]\n${body}`;
        }
      }
    }

    return {
      id: message.id || 'unknown',
      threadId: message.threadId || null,
      subject,
      from,
      to: to ? to.split(',').map(addr => addr.trim()) : [],
      cc: cc ? cc.split(',').map(addr => addr.trim()) : [],
      bcc: bcc ? bcc.split(',').map(addr => addr.trim()) : [],
      date,
      snippet: message.snippet || null,
      body,
      labels: message.labelIds || [],
      participants,
    };
  }

  private parseEmailAddress(address: string): { email: string; name: string } {
    // Handle format: "Name <email@example.com>"
    const match = address.match(/^"?([^"<]+?)"?\s*<(.+)>$/);
    if (match) {
      return {
        name: match[1].trim(),
        email: match[2].trim(),
      };
    }

    // Handle plain email
    return {
      email: address.trim(),
      name: address.trim(),
    };
  }

  private decodeBase64(data: string): string {
    try {
      // Gmail API uses URL-safe base64
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(base64, 'base64').toString('utf-8');
    } catch (error) {
      this.logger.error('Error decoding base64 data', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return '';
    }
  }
}
