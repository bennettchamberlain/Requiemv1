/**
 * Narrator: renders an already-computed answer into a human sentence.
 *
 * The compute-then-narrate split means the NUMBER is always produced
 * deterministically (see DescriptiveQuestionService); the narrator only phrases
 * it. `TemplateNarrator` is the always-available, dependency-free fallback.
 * `OllamaNarrator` shows how a real LLM narrator slots into the same interface
 * WITHOUT the engine hard-depending on Ollama being reachable: it wraps a
 * minimal `TextGenerator` port, falls back to the template on any error, and
 * it can never change the computed value.
 */

import { formatValue } from './answerMath';
import type { QuestionSpec, Timeframe } from './questionCatalog';

export interface AnswerProvenance {
  metric: string;
  sources: readonly string[];
  daysWithData: number;
  coveragePct: number;
}

export interface NarrationInput {
  spec: QuestionSpec;
  /** The deterministically computed (and scaled) value, or null when there's no data. */
  value: number | null;
  timeframe: Timeframe;
  days: number;
  daysWithData: number;
  coveragePct: number;
}

export interface Narrator {
  narrate(input: NarrationInput): Promise<string>;
}

/** DI token so a deployment can bind a different Narrator implementation. */
export const NARRATOR = Symbol('NARRATOR');

function templateFields(input: NarrationInput): Record<string, string | number> {
  const displayValue = input.value === null ? 'n/a' : formatValue(input.value, input.spec.format);

  return {
    value: displayValue,
    unit: input.spec.unit ?? '',
    timeframe: input.timeframe.label,
    days: input.days,
    daysWithData: input.daysWithData,
    coveragePct: input.coveragePct,
  };
}

/** Replace {key} tokens in a template with the matching field value. */
export function interpolateTemplate(template: string, fields: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in fields ? String(fields[key]) : match,
  );
}

/** Deterministic, dependency-free narrator. Always available. */
export class TemplateNarrator implements Narrator {
  async narrate(input: NarrationInput): Promise<string> {
    if (input.value === null) {
      return `I don't have enough data yet to answer: "${input.spec.question}"`;
    }

    return interpolateTemplate(input.spec.template, templateFields(input));
  }
}

/** Minimal text-generation port a real Ollama client can implement. */
export interface TextGenerator {
  generate(prompt: string): Promise<string>;
}

/**
 * LLM narrator that phrases the already-computed answer more naturally, but
 * falls back to the deterministic template if generation fails, returns
 * nothing, or drops the formatted number — so the engine never hard-depends
 * on Ollama, and the model is never allowed to invent or change the number.
 */
export class OllamaNarrator implements Narrator {
  constructor(
    private readonly generator: TextGenerator,
    private readonly fallback: Narrator = new TemplateNarrator(),
  ) {}

  async narrate(input: NarrationInput): Promise<string> {
    const deterministic = await this.fallback.narrate(input);
    if (input.value === null) {
      return deterministic;
    }

    const formatted = formatValue(input.value, input.spec.format);

    try {
      const text = (await this.generator.generate(this.buildPrompt(input, deterministic))).trim();
      if (text.length > 0 && text.includes(formatted)) {
        return text;
      }

      return deterministic;
    } catch {
      return deterministic;
    }
  }

  private buildPrompt(input: NarrationInput, deterministic: string): string {
    return [
      'Rephrase the following statistic as one short, friendly sentence.',
      'Do NOT change any number, unit, or timeframe. Do not add facts.',
      `Question: ${input.spec.question}`,
      `Fact: ${deterministic}`,
      'Sentence:',
    ].join('\n');
  }
}
