import { OllamaNarrator, TemplateNarrator, type NarrationInput, type TextGenerator } from './Narrator';
import { TODAY } from './questionCatalog';

const INPUT: NarrationInput = {
  spec: {
    key: 'rel.conversations_today',
    category: 'Relationships',
    question: 'How many conversations did I have today?',
    metric: 'n_conversations',
    aggregate: 'latest',
    timeframe: TODAY,
    format: 'int',
    template: 'You had {value} conversations {timeframe}.',
  },
  value: 7,
  timeframe: TODAY,
  days: 1,
  daysWithData: 1,
  coveragePct: 100,
};

describe('OllamaNarrator', () => {
  it('keeps a rephrase that still contains the computed number', async () => {
    const generator: TextGenerator = {
      async generate() {
        return 'Looks like you had 7 conversations today.';
      },
    };

    await expect(new OllamaNarrator(generator).narrate(INPUT)).resolves.toBe(
      'Looks like you had 7 conversations today.',
    );
  });

  it('falls back when the model invents a different number', async () => {
    const generator: TextGenerator = {
      async generate() {
        return 'You had 42 conversations today.';
      },
    };

    await expect(new OllamaNarrator(generator).narrate(INPUT)).resolves.toBe(
      'You had 7 conversations today.',
    );
  });

  it('falls back when generation throws', async () => {
    const generator: TextGenerator = {
      async generate() {
        throw new Error('offline');
      },
    };

    await expect(new OllamaNarrator(generator).narrate(INPUT)).resolves.toBe(
      'You had 7 conversations today.',
    );
  });
});

describe('TemplateNarrator', () => {
  it('does not invent a number when the value is missing', async () => {
    await expect(new TemplateNarrator().narrate({ ...INPUT, value: null })).resolves.toContain(
      "don't have enough data",
    );
  });
});
