import {
  ANSWER_SUPPORT_LEVELS,
  answersTheQuestion,
  calibrateInferredConfidence,
  confidenceLabel,
  CONFIDENCE_IMPLIED_CEILING,
  CONFIDENCE_NON_ANSWER,
  CONFIDENCE_OFF_QUESTION,
  DEFAULT_MIN_ANSWER_CONFIDENCE,
  estimateInferredAnswerConfidence,
  INFERRED_ANSWER_JSON_SCHEMA,
  INFERRED_ANSWER_PROMPT_RULES,
  isNarratedVoice,
  isNonAnswer,
  normalizeAnswerSupport,
  parseInferredAnswer,
  supportConfidenceCeiling,
  sanitizeInferredAnswerVoice,
} from '../inferredAnswerConfidence';

describe('estimateInferredAnswerConfidence', () => {
  it('scores thin context lower than rich RAG context', () => {
    expect(estimateInferredAnswerConfidence(0, false)).toBeLessThan(0.7);
    expect(estimateInferredAnswerConfidence(5, true)).toBeGreaterThanOrEqual(0.85);
  });

  it('raises the ceiling for evidence retrieved from the user’s own memory', () => {
    // The point of the RAG leg: an answer read off the user's records must be
    // allowed to outscore one invented from the same thin dossier, or widening
    // retrieval cannot change anything that reaches the database.
    expect(estimateInferredAnswerConfidence(0, false, 6)).toBeGreaterThan(
      estimateInferredAnswerConfidence(0, false, 0),
    );
    expect(estimateInferredAnswerConfidence(0, false, 6)).toBeGreaterThan(DEFAULT_MIN_ANSWER_CONFIDENCE);
  });

  it('leaves the ceiling untouched for callers that pass no retrieval count', () => {
    expect(estimateInferredAnswerConfidence(3, true)).toBe(estimateInferredAnswerConfidence(3, true, 0));
  });

  it('never exceeds the cap, however much evidence is piled on', () => {
    expect(estimateInferredAnswerConfidence(50, true, 50)).toBe(0.95);
  });
});

describe('parseInferredAnswer', () => {
  it('reads answer, confidence and rationale out of a clean structured response', () => {
    const parsed = parseInferredAnswer(
      '{"answer":"I mostly drink tea.","confidence":0.82,"rationale":"You said so in the coffee question."}',
    );

    expect(parsed).toEqual({
      answer: 'I mostly drink tea.',
      confidence: 0.82,
      rationale: 'You said so in the coffee question.',
    });
  });

  it('tolerates a markdown fence and leading prose around the JSON', () => {
    const parsed = parseInferredAnswer(
      'Sure! Here is the JSON:\n```json\n{"answer":"Blue.","confidence":0.5,"rationale":"Two prior answers."}\n```',
    );

    expect(parsed?.answer).toBe('Blue.');
    expect(parsed?.confidence).toBe(0.5);
  });

  it('rescales a percentage-style confidence into [0,1]', () => {
    // Models emit `85` for "85%" about as readily as `0.85`.
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":85,"rationale":"x"}')?.confidence).toBe(0.85);
  });

  it('clamps an out-of-range confidence rather than storing it', () => {
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":-3,"rationale":"x"}')?.confidence).toBe(0);
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":400,"rationale":"x"}')?.confidence).toBe(1);
  });

  it('keeps the answer when the rationale is missing or blank, dropping the empty rationale', () => {
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":0.6}')).toEqual({
      answer: 'Yes.',
      confidence: 0.6,
    });
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":0.6,"rationale":"   "}')).toEqual({
      answer: 'Yes.',
      confidence: 0.6,
    });
  });

  it('returns null — never a substituted default — when confidence is absent or not a number', () => {
    // Inventing a score here would be the exact fabrication the floor exists to
    // prevent, so an unscored generation is a parse failure.
    expect(parseInferredAnswer('{"answer":"Yes.","rationale":"x"}')).toBeNull();
    expect(parseInferredAnswer('{"answer":"Yes.","confidence":"very","rationale":"x"}')).toBeNull();
  });

  it('returns null for an empty answer, prose, or unparseable content', () => {
    expect(parseInferredAnswer('{"answer":"   ","confidence":0.9}')).toBeNull();
    expect(parseInferredAnswer('I think you probably like tea.')).toBeNull();
    expect(parseInferredAnswer('')).toBeNull();
    expect(parseInferredAnswer('{"tasks": [}')).toBeNull();
  });
});

describe('isNonAnswer — the "nothing to share" shape', () => {
  // Measured live: written to the profile at 0.05 after the record-reference
  // rule shipped, because it names no record at all. The absent thing is the
  // very thing asked for, and the tell is the trailing "to share".
  it('flags a first-person refusal that names no record', () => {
    expect(isNonAnswer('I do not have a description of my sexual orientation to share.')).toBe(true);
    expect(isNonAnswer("I don't have any specific details to share.")).toBe(true);
    expect(isNonAnswer('I do not have an answer to give.')).toBe(true);
  });

  // The expensive direction. "I don't have a car" is a real answer to "do you
  // own a car?", and differs from the refusals above only by the missing
  // "to share" tail — which is why that tail is required rather than optional.
  it('leaves real answers of the same grammatical shape alone', () => {
    expect(isNonAnswer("I don't have a car.")).toBe(false);
    expect(isNonAnswer('I do not have any siblings.')).toBe(false);
    expect(isNonAnswer('I do not have a favorite.')).toBe(false);
  });
});

describe('isNonAnswer', () => {
  it.each([
    // The measured failure: perfect restaurant evidence, refused anyway.
    'I do not have this information recorded.',
    "I don't have this information recorded",
    'I don’t know.',
    'I do not know what my favourite cuisine is.',
    'I have no information about that.',
    "I don't have enough information to answer.",
    'I cannot determine that from the evidence.',
    "I don't recall.",
    'No information recorded.',
    'No data available for this question.',
    'Not recorded.',
    'Unknown',
    'N/A',
    'There is no information about this in the evidence.',
    'Nothing in the evidence speaks to this.',
    'The evidence does not mention any cuisine.',
    'Insufficient information.',
    'Sorry, I do not have this information recorded.',
    'As the user, I do not have any information about that.',
    'That information is not recorded.',
  ])('flags the refusal %p', (answer) => {
    expect(isNonAnswer(answer)).toBe(true);
  });

  it.each([
    // Real answers that merely start with a negative, or contain a refusal-ish
    // word. Discarding these would cost a genuine answer.
    "I don't drink coffee.",
    "I don't eat meat.",
    'None that I know of.',
    'No siblings.',
    'There is nothing I enjoy more than surfing.',
    'Nothing beats a long drive.',
    'Japanese, Mexican and Thai — I eat across all three.',
    'Los Angeles.',
    'Night owl',
    'Unknown Pleasures by Joy Division.',
    'Data engineering.',
    'I know a fair bit of Spanish.',
  ])('leaves the real answer %p alone', (answer) => {
    expect(isNonAnswer(answer)).toBe(false);
  });

  it('is not tripped by an empty string', () => {
    expect(isNonAnswer('')).toBe(false);
    expect(isNonAnswer('   ')).toBe(false);
  });
});

describe('isNonAnswer — refusals that report on the record instead of answering', () => {
  it.each([
    // The measured live miss. It names no "I don't know" phrase at all; what
    // makes it a refusal is that its subject is the record's silence, and it was
    // written to the owner's profile under "What pronouns do you use?".
    'I have not explicitly stated my pronouns in this record.',
    // Same shape with no mention of the record — the phrase guard, alone.
    'I have never explicitly stated my pronouns anywhere.',
    // The gap reported with the person's own attribute as the subject.
    'My blood type is not specified anywhere.',
    // Contracted, with a word between subject and verb: the pre-existing
    // "(?:does|do|did) not" guard let this through untouched.
    "The evidence here doesn't mention any of that.",
    // No enumerated phrase matches this one at all — it is caught structurally,
    // by being a claim of absence made about the record.
    'Nothing about my pronouns appears anywhere in this record.',
    'My favourite film is not something I have mentioned in these records.',
  ])('flags the record-report %p', (answer) => {
    expect(isNonAnswer(answer)).toBe(true);
  });

  it.each([
    // The live corpus's own good answers. Every one of these is a real thing the
    // owner would say, and the widened patterns must not cost any of them.
    'I am a night owl.',
    'Camarillo',
    'I am definitely a cat person.',
    'I sit on the board of an education charity called TAG and volunteer there.',
    "I've been studying English, Sign Language, and German, but I'm also interested in expanding my skills across many different languages.",
    'I grew up all over — San Diego, Yorba Linda, Seattle, and Anchorage; I am a military brat who changed schools often.',
    'Mexican and Indian cuisine is my usual go to, but I also adore Asian and French dishes.',
    // Reads like the refusal shapes above and is not one: "any specific food" is
    // the object, not "any information".
    "I don't have any specific food I refuse to eat under all circumstances.",
    // A negation next to a container word, which is why the structural rule
    // needs BOTH halves and keeps its noun list narrow.
    'I write everything down in my notes, never on paper.',
    'I keep my calendar empty on Fridays, no exceptions.',
  ])('leaves the real answer %p alone', (answer) => {
    expect(isNonAnswer(answer)).toBe(false);
  });
});

describe('sanitizeInferredAnswerVoice', () => {
  it('strips the narrator lead-in and leaves the person speaking', () => {
    // Measured live: written to the profile under "Which hobby have you kept the
    // longest…". The fact inside it is worth keeping; the narration is not.
    expect(
      sanitizeInferredAnswerVoice('My record shows I have maintained a strong interest in woodworking.'),
    ).toBe('I have maintained a strong interest in woodworking.');
    expect(sanitizeInferredAnswerVoice('Based on the evidence, I prefer the beach.')).toBe(
      'I prefer the beach.',
    );
    expect(sanitizeInferredAnswerVoice('According to my records, I fly out of LAX.')).toBe(
      'I fly out of LAX.',
    );
    // Narration with the corpus left implicit.
    expect(sanitizeInferredAnswerVoice('It appears that I prefer mornings.')).toBe('I prefer mornings.');
  });

  it('recapitalizes what is left when the lead-in took the sentence opening with it', () => {
    expect(sanitizeInferredAnswerVoice('The records indicate a long-standing interest in hockey.')).toBe(
      'A long-standing interest in hockey.',
    );
  });

  it('strips the same leak arriving as a tail', () => {
    expect(sanitizeInferredAnswerVoice('I prefer the beach, based on the evidence below.')).toBe(
      'I prefer the beach.',
    );
  });

  it('repairs mid-sentence narration of the retrieval itself', () => {
    // Measured live, inside an otherwise good answer to "In which city did you
    // spend most of your childhood?" — the list IS the answer, "listing
    // locations like" is the model describing its own lookup. A dash carries the
    // same sentence, so this is repaired rather than thrown away.
    const sanitized = sanitizeInferredAnswerVoice(
      'I grew up all over, listing locations like San Diego, Yorba Linda, Seattle, and Anchorage; I am a military brat.',
    );

    expect(sanitized).not.toContain('listing locations like');
    expect(sanitized).toBe(
      'I grew up all over — San Diego, Yorba Linda, Seattle, and Anchorage; I am a military brat.',
    );
  });

  it.each([
    'I am a night owl.',
    'Camarillo',
    'I am definitely a cat person.',
    'I sit on the board of an education charity called TAG and volunteer there.',
    // "in the data" is a job, not a citation — which is why the tail rule has no
    // bare "in"/"from" preposition.
    'I work in the data.',
    'Data engineering.',
  ])('leaves the real answer %p exactly as written', (answer) => {
    expect(sanitizeInferredAnswerVoice(answer)).toBe(answer);
  });
});

describe('isNarratedVoice', () => {
  it.each([
    // Narration woven into the claim: nothing can be stripped without rewriting
    // what the sentence says, so the row is dropped instead.
    'The user prefers mornings.',
    'A strong, ongoing interest in hobbies, per my records.',
    'My record shows a long-standing general interest in hobbies and supplies.',
    'This person tends to message their sister most.',
    'There is a clear pattern in the evidence of frequent hiking.',
    // The corpus named in passing — no citation frame, no narrator verb, still
    // the user talking about their database instead of their life.
    'Woodworking, though my records only go back a few years.',
    // 'data' is an ordinary word, so it only narrates when cited as a source…
    'Mostly Thai, based on the data.',
    // …or when it is the one doing the talking.
    'The data suggests I run in the mornings.',
    // Corpus-speak wherever it lands, not only as the subject.
    'Mostly Thai food, judging by what the user orders.',
  ])('flags the narrated answer %p', (answer) => {
    expect(isNarratedVoice(answer)).toBe(true);
  });

  it.each([
    'I am a night owl.',
    'Camarillo',
    'I am definitely a cat person.',
    'I grew up all over — San Diego, Yorba Linda, Seattle, and Anchorage; I am a military brat.',
    'I sit on the board of an education charity called TAG and volunteer there.',
    // Ordinary words that happen to name a kind of data.
    'Data engineering.',
    'I studied history at university.',
    'I am definitely more of a dog person than a cat person.',
    // "the person" mid-sentence is ordinary English; only corpus-speak is caught.
    "I'm the person everyone calls at 2am.",
    // What the sanitizer produces from a stripped lead-in must itself pass.
    'I have maintained a strong interest in woodworking.',
  ])('leaves the first-person answer %p alone', (answer) => {
    expect(isNarratedVoice(answer)).toBe(false);
  });

  it('is not tripped by an empty string', () => {
    expect(isNarratedVoice('')).toBe(false);
    expect(isNarratedVoice('   ')).toBe(false);
  });
});

describe('parseInferredAnswer — voice repair', () => {
  it('stores the answer in the user’s own voice, not the narrator’s', () => {
    const parsed = parseInferredAnswer(
      '{"answer":"My record shows I have kept up with woodworking for fifteen years.","confidence":0.6,"rationale":"Six workshop purchases."}',
    );

    expect(parsed?.answer).toBe('I have kept up with woodworking for fifteen years.');
    // The evidence still gets named — in the field whose job that is.
    expect(parsed?.rationale).toBe('Six workshop purchases.');
  });

  it('catches the refusal the narrator framing was hiding', () => {
    // Order matters: stripping runs BEFORE the non-answer check, so a refusal
    // wearing a lead-in is clamped like any other refusal instead of sailing
    // past on a phrase the pattern list never sees.
    const parsed = parseInferredAnswer(
      '{"answer":"Based on the evidence, there is no mention of pronouns.","confidence":0.8,"rationale":"x"}',
    );

    expect(parsed?.confidence).toBe(CONFIDENCE_NON_ANSWER);
  });
});

describe('parseInferredAnswer — non-answer confidence clamp', () => {
  it('clamps the exact measured failure: a refusal self-scored at 0.7', () => {
    // Retrieval handed the model three restaurant visits; it refused and then
    // scored the refusal 0.7, clearing the 0.4 floor meant to filter it out.
    // `confidence` means "how sure am I of this answer" — there is no answer
    // here, so the score is answering a different question and must not stand.
    const parsed = parseInferredAnswer(
      '{"answer":"I do not have this information recorded.","confidence":0.7,"rationale":"No line states a favorite cuisine."}',
    );

    expect(parsed?.confidence).toBe(CONFIDENCE_NON_ANSWER);
    expect(parsed?.confidence).toBeLessThan(0.2);
    expect(parsed?.confidence).toBeLessThan(DEFAULT_MIN_ANSWER_CONFIDENCE);
  });

  it('clamps a refusal that arrives as a percentage too', () => {
    expect(parseInferredAnswer('{"answer":"Unknown.","confidence":90,"rationale":"x"}')?.confidence).toBe(
      CONFIDENCE_NON_ANSWER,
    );
  });

  it('does not raise a refusal that already scored itself honestly low', () => {
    // Clamp, not assignment: an honest 0.05 stays 0.05.
    expect(
      parseInferredAnswer('{"answer":"I don\'t know.","confidence":0.05,"rationale":"x"}')?.confidence,
    ).toBe(0.05);
  });

  it('leaves a real synthesized answer at the score the model gave it', () => {
    const parsed = parseInferredAnswer(
      '{"answer":"Japanese, Mexican and Thai — I eat across all three.","confidence":0.55,"rationale":"Three restaurants in browser history."}',
    );

    expect(parsed?.confidence).toBe(0.55);
  });
});

describe('calibrateInferredConfidence', () => {
  it('caps an overconfident model at what the available evidence supports', () => {
    // No dossier, no related answers: the model saying 0.95 does not make it so.
    const ceiling = estimateInferredAnswerConfidence(0, false);

    expect(calibrateInferredConfidence(0.95, ceiling)).toBe(ceiling);
  });

  it('keeps an honestly low model score even when evidence was plentiful', () => {
    expect(calibrateInferredConfidence(0.2, estimateInferredAnswerConfidence(6, true))).toBe(0.2);
  });

  it('clamps a model score outside [0,1] before comparing', () => {
    expect(calibrateInferredConfidence(-1, 0.9)).toBe(0);
    expect(calibrateInferredConfidence(2, 0.9)).toBe(0.9);
  });

  it('can land below the default floor, which is what makes the refusal reachable', () => {
    expect(calibrateInferredConfidence(0.25, 0.9)).toBeLessThan(DEFAULT_MIN_ANSWER_CONFIDENCE);
  });
});

describe('confidenceLabel', () => {
  it('labels each band of the documented scale', () => {
    expect(confidenceLabel(0.95)).toBe('high');
    expect(confidenceLabel(0.9)).toBe('high');
    expect(confidenceLabel(0.75)).toBe('moderate');
    expect(confidenceLabel(0.4)).toBe('low');
    expect(confidenceLabel(0.1)).toBe('very low');
  });
});

describe('the prompt contract', () => {
  it('requires every field the parser reads, so a schema-constrained model emits all of them', () => {
    expect(INFERRED_ANSWER_JSON_SCHEMA.required).toEqual([
      'asked_for',
      'support',
      'answer',
      'confidence',
      'rationale',
    ]);
  });

  it('declares the relevance judgement BEFORE the answer, so the answer is conditioned on it', () => {
    // Property order drives generation order under a schema-constrained
    // grammar. Declared after `answer`, `support` would be a label stuck on a
    // sentence already written — which is what the model does unprompted, and
    // what scored "There are doctors in my family." at 0.9 on a question about
    // hereditary conditions.
    const properties = Object.keys(INFERRED_ANSWER_JSON_SCHEMA.properties as Record<string, unknown>);

    expect(properties.indexOf('asked_for')).toBeLessThan(properties.indexOf('answer'));
    expect(properties.indexOf('support')).toBeLessThan(properties.indexOf('answer'));
  });

  it('states the scale to the model using the same numbers the code bands on', () => {
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('0.9');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('0.7');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('0.4');
  });

  it('asks for one short sentence or the bare fact, not a paragraph', () => {
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('ONE short first-person sentence');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('just the bare fact');
    expect(INFERRED_ANSWER_PROMPT_RULES).not.toContain('2-3 sentences');
  });

  it('routes uncertainty into the confidence score instead of into a hedging answer', () => {
    // The reported failure was a written answer reading "I'm not sure, I haven't
    // really thought about whether I prefer mornings or nights" — a non-answer
    // persisted as though the user had said it. The prompt must name that shape
    // and point it at the score instead.
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('NEVER hedge in the answer field');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain("I'm not sure");
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain("I haven't really thought about it");
  });

  it('separates inventing (forbidden) from inferring (the job)', () => {
    // The rules previously pushed only against fabrication, and the model read
    // that as "refuse unless a line says it outright" — so perfect evidence
    // produced "I do not have this information recorded."
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('SYNTHESIS, NOT LOOKUP');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('INVENTING');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('INFERRING');
    expect(INFERRED_ANSWER_PROMPT_RULES).toMatch(/indirect evidence is still evidence/i);
  });

  it('carries a worked example of the shape that was failing', () => {
    // Not decoration: the cuisine case is the measured failure, and showing the
    // correct output beside the wrong one is what makes the rule legible.
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('Japanese Cuisine');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('Thai Cuisine');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('I do not have this information recorded.');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('WRONG');
  });

  it('forbids narrating the corpus and names the leaks measured in production', () => {
    // "My record shows…" and "listing locations like…" were both written to the
    // owner's profile, where they read as the user describing their own data.
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('SPEAK AS THE PERSON');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('My record shows');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('based on the evidence');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('listing locations like');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('the user');
  });

  it('requires the answer to cover what the question actually asked', () => {
    // "Which hobby have you kept the longest, and for how many years?" came back
    // naming no hobby and no number — a sentence, but not an answer.
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('ANSWER EVERY PART THE QUESTION ACTUALLY ASKS');
    expect(INFERRED_ANSWER_PROMPT_RULES).toMatch(/vacuous/i);
  });

  it('tells the model a non-answer scores low, using the number the code clamps to', () => {
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('A NON-ANSWER MUST SCORE LOW');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain(`at most ${CONFIDENCE_NON_ANSWER}`);
    expect(CONFIDENCE_NON_ANSWER).toBeLessThan(0.2);
  });
});

describe('normalizeAnswerSupport', () => {
  it('accepts the documented levels in any casing or padding', () => {
    expect(normalizeAnswerSupport('stated')).toBe('stated');
    expect(normalizeAnswerSupport(' Implied ')).toBe('implied');
    expect(normalizeAnswerSupport('TOPICAL')).toBe('topical');
    expect(normalizeAnswerSupport('none')).toBe('none');
  });

  it('treats anything else as no judgement rather than as a failure', () => {
    // A strict enum in the zod schema would fail the WHOLE parse on a word like
    // "partial", throwing away a good answer over a label. An unreadable label
    // is an absent judgement, which is the pre-existing behaviour.
    expect(normalizeAnswerSupport('partial')).toBeUndefined();
    expect(normalizeAnswerSupport(undefined)).toBeUndefined();
    expect(normalizeAnswerSupport(3)).toBeUndefined();
  });
});

describe('answersTheQuestion', () => {
  it('rejects the two near-miss levels and nothing else', () => {
    expect(answersTheQuestion('stated')).toBe(true);
    expect(answersTheQuestion('implied')).toBe(true);
    expect(answersTheQuestion('topical')).toBe(false);
    expect(answersTheQuestion('none')).toBe(false);
  });

  it('treats a missing judgement as an answer, so callers that never ask are unaffected', () => {
    expect(answersTheQuestion(undefined)).toBe(true);
  });
});

describe('supportConfidenceCeiling', () => {
  it('caps an inference below the band the scale reserves for a stated fact', () => {
    expect(supportConfidenceCeiling('implied')).toBe(CONFIDENCE_IMPLIED_CEILING);
    expect(CONFIDENCE_IMPLIED_CEILING).toBeLessThan(0.9);
  });

  it('puts a near miss where a refusal sits, because it is the same event', () => {
    expect(supportConfidenceCeiling('topical')).toBe(CONFIDENCE_OFF_QUESTION);
    expect(supportConfidenceCeiling('none')).toBe(CONFIDENCE_OFF_QUESTION);
    expect(CONFIDENCE_OFF_QUESTION).toBeLessThan(DEFAULT_MIN_ANSWER_CONFIDENCE);
  });

  it('constrains neither a stated fact nor an absent judgement', () => {
    expect(supportConfidenceCeiling('stated')).toBe(1);
    expect(supportConfidenceCeiling(undefined)).toBe(1);
  });
});

describe('parseInferredAnswer — relevance clamp', () => {
  it('clamps a confident answer the model itself called topical', () => {
    // The measured live failure: "Which health conditions run in your immediate
    // family?" answered "There are doctors in my family." at 0.90, off evidence
    // that matched on 'family' and named no condition at all.
    const parsed = parseInferredAnswer(
      JSON.stringify({
        asked_for: 'named medical conditions occurring in my blood relatives',
        support: 'topical',
        answer: 'There are doctors in my family.',
        confidence: 0.9,
        rationale: 'doctors in my family.',
      }),
    );

    expect(parsed?.confidence).toBe(CONFIDENCE_OFF_QUESTION);
    expect(parsed?.support).toBe('topical');
    expect(parsed?.askedFor).toBe('named medical conditions occurring in my blood relatives');
  });

  it('clamps an implied answer out of the stated band', () => {
    expect(
      parseInferredAnswer('{"support":"implied","answer":"Thai.","confidence":0.95,"rationale":"x"}')
        ?.confidence,
    ).toBe(CONFIDENCE_IMPLIED_CEILING);
  });

  it('leaves a stated answer and an unlabelled one at the model’s own score', () => {
    expect(
      parseInferredAnswer('{"support":"stated","answer":"Camarillo","confidence":0.95,"rationale":"x"}')
        ?.confidence,
    ).toBe(0.95);
    expect(parseInferredAnswer('{"answer":"Camarillo","confidence":0.95,"rationale":"x"}')?.confidence).toBe(
      0.95,
    );
  });

  it('never RAISES a score to its ceiling', () => {
    expect(
      parseInferredAnswer('{"support":"stated","answer":"Camarillo","confidence":0.3,"rationale":"x"}')
        ?.confidence,
    ).toBe(0.3);
  });

  it('keeps the answer when the support label is a word it does not recognise', () => {
    const parsed = parseInferredAnswer(
      '{"support":"partial","answer":"Camarillo","confidence":0.9,"rationale":"x"}',
    );

    expect(parsed?.answer).toBe('Camarillo');
    expect(parsed?.confidence).toBe(0.9);
    expect(parsed?.support).toBeUndefined();
  });

  it('still clamps a refusal that labelled itself well supported', () => {
    expect(
      parseInferredAnswer(
        '{"support":"stated","answer":"I do not have this information recorded.","confidence":0.9,"rationale":"x"}',
      )?.confidence,
    ).toBe(CONFIDENCE_NON_ANSWER);
  });
});

describe('the prompt contract — relevance and cross-question bleed', () => {
  it('tells the model to answer the question asked, not the one the evidence answers', () => {
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain(
      'ANSWER THE QUESTION ASKED, NOT THE ONE THE EVIDENCE ANSWERS',
    );
    expect(INFERRED_ANSWER_PROMPT_RULES).toMatch(/near miss/i);
  });

  it('defines every support level the code enforces', () => {
    for (const level of ANSWER_SUPPORT_LEVELS) {
      expect(INFERRED_ANSWER_PROMPT_RULES).toContain(level);
    }
  });

  it('teaches confidence as how well the evidence answers THIS question, not how much came back', () => {
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('It is not how much evidence came back');
    expect(INFERRED_ANSWER_PROMPT_RULES).toMatch(/circle the topic without ever naming the thing/i);
  });

  it('carries the health-conditions near miss as a worked WRONG example', () => {
    // The worked examples are what the model actually generalises from; a rule
    // with no example beside it did not stop the 0.90 in the first place.
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('Which health conditions run in your immediate family?');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('There are doctors in my family.');
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('Doctors are not conditions');
  });

  it('states that evidence does not transfer between neighbouring questions', () => {
    expect(INFERRED_ANSWER_PROMPT_RULES).toContain('EVIDENCE DOES NOT TRANSFER BETWEEN QUESTIONS');
    expect(INFERRED_ANSWER_PROMPT_RULES).toMatch(/speaking a language is not learning one/i);
    expect(INFERRED_ANSWER_PROMPT_RULES).toMatch(/prior answers to other questions are context/i);
  });
});
