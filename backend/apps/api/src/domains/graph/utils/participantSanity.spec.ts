import { Logger } from '@nestjs/common';

import {
  CALL_LOG_HEADING,
  isNonNameParticipant,
  nonNameParticipantReason,
  resetNonNameParticipantLog,
  stripCallLogHeading,
} from './participantSanity';

describe('nonNameParticipantReason', () => {
  describe('call-log headings — all FIVE verbs googlevoice.ts derives CallType from', () => {
    // googlevoice.ts reads the type off the filename with
    // /(Missed|Placed|Received|Voicemail|Recorded)/. An earlier backfill covered
    // only Missed/Placed/Received, which is why "Voicemail from" and "Recorded
    // call with" were still polluting names and content.
    it.each([
      ['Missed call from', 'missed'],
      ['Placed call to', 'placed'],
      ['Received call from', 'received'],
      ['Voicemail from', 'voicemail'],
      ['Recorded call with', 'recorded'],
    ])('refuses a bare %s heading (%s)', (heading) => {
      expect(nonNameParticipantReason(heading)).toBe('call_log_heading');
    });

    it('refuses a heading that also carries the contact name on the same line', () => {
      expect(nonNameParticipantReason('Placed call to Nancy Davis')).toBe('call_log_heading');
    });

    it('refuses the shared-span shape, heading + newline + name', () => {
      // The exact live shape: 3,079 Person rows were named like this.
      expect(nonNameParticipantReason('Missed call from \nSteven Stone')).toBe('embedded_newline');
    });

    it('is case-insensitive and tolerates leading whitespace', () => {
      expect(nonNameParticipantReason('   voicemail FROM ')).toBe('call_log_heading');
    });
  });

  describe('export filenames', () => {
    it('refuses the Google Voice group-thread filename', () => {
      expect(nonNameParticipantReason('Group Conversation - 2024-09-25T01_45_41Z.html')).toBe(
        'export_filename',
      );
    });

    it('refuses a bare basename that leaked out of a label parse', () => {
      for (const value of ['messages.json', 'contacts.vcf', 'export.CSV', 'thread.htm', 'notes.txt']) {
        expect(nonNameParticipantReason(value)).toBe('export_filename');
      }
    });
  });

  describe('newlines', () => {
    it('refuses any participant carrying a newline, whatever the kind looks like', () => {
      expect(nonNameParticipantReason('Alice\nSmith')).toBe('embedded_newline');
      expect(nonNameParticipantReason('alice@example.com\r\nbob@example.com')).toBe('embedded_newline');
    });
  });

  describe('what it must NOT refuse — the guard is narrow on purpose', () => {
    it.each([
      'Steven Stone',
      'alice@example.com',
      '+1 (415) 555-0100',
      'alexmz12',
      '42',
      'Missy Toner',
      'Placido Domingo',
      'Tom Received',
      'Bob With',
      'José García',
      '@alice',
      'x:@alice',
    ])('accepts %s', (value) => {
      expect(nonNameParticipantReason(value)).toBeNull();
    });

    it('cannot fire on an email address whose local part starts with a verb', () => {
      // The heading rule requires whitespace between the verb, the optional
      // "call" and the preposition; an address has none. A looser rule keyed on
      // "verb ... preposition somewhere on the line" refuses this one.
      expect(nonNameParticipantReason('voicemail@from.example.com')).toBeNull();
      expect(nonNameParticipantReason('received-to@example.com')).toBeNull();
    });

    it('treats empty and null as nothing, not as garbage', () => {
      expect(nonNameParticipantReason(null)).toBeNull();
      expect(nonNameParticipantReason(undefined)).toBeNull();
      expect(nonNameParticipantReason('')).toBeNull();
      expect(nonNameParticipantReason('   ')).toBeNull();
    });
  });
});

describe('stripCallLogHeading', () => {
  it.each([
    ['Missed call from \nSteven Stone', 'Steven Stone'],
    ['Placed call to Nancy Davis', 'Nancy Davis'],
    ['Received call from \nWilliam E Broza', 'William E Broza'],
    ['Voicemail from \nJudy Collins', 'Judy Collins'],
    ['Recorded call with \nEllen Louie', 'Ellen Louie'],
  ])('recovers the contact out of %s', (raw, expected) => {
    expect(stripCallLogHeading(raw)).toBe(expected);
  });

  it('returns empty when the export named nobody', () => {
    expect(stripCallLogHeading('Missed call from \n')).toBe('');
    expect(stripCallLogHeading('Voicemail from')).toBe('');
  });

  it('leaves a string that carries no heading alone', () => {
    expect(stripCallLogHeading('  Steven Stone  ')).toBe('Steven Stone');
  });

  it('is the same pattern the refusal uses, so strip and refuse can never drift', () => {
    const heading = 'Recorded call with ';
    expect(CALL_LOG_HEADING.test(heading)).toBe(true);
    expect(nonNameParticipantReason(heading)).toBe('call_log_heading');
    expect(stripCallLogHeading(heading)).toBe('');
  });
});

describe('isNonNameParticipant', () => {
  beforeEach(() => {
    resetNonNameParticipantLog();
  });

  it('reports the refusal as a boolean the minters can branch on', () => {
    expect(isNonNameParticipant('Missed call from', 'spec')).toBe(true);
    expect(isNonNameParticipant('Steven Stone', 'spec')).toBe(false);
  });

  it('logs the FIRST occurrence of each reason, and does not log every row after it', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    try {
      for (let i = 0; i < 50; i += 1) {
        isNonNameParticipant('Missed call from', 'spec');
      }

      isNonNameParticipant('Group Conversation - 2024-09-25T01_45_41Z.html', 'spec');

      // One line for the heading (the first of its 50), one for the filename.
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toContain('call_log_heading');
      expect(warn.mock.calls[1][0]).toContain('export_filename');
    } finally {
      warn.mockRestore();
    }
  });

  it('truncates the refused value — it is untrusted input', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    try {
      isNonNameParticipant(`Missed call from ${'x'.repeat(500)}`, 'spec');

      expect(String(warn.mock.calls[0][0]).length).toBeLessThan(300);
    } finally {
      warn.mockRestore();
    }
  });
});
