-- migrate:up

-- `ci.answers.answer_confidence` has existed since the table was created
-- (20250925145200) and is NULL on every row: the one writer that produces
-- `answer_source = 'inferred'` rows — the RAG answer-inference listener — asked
-- the model for prose and had nowhere to record how sure it was. A user reading
-- their own reflections could not tell an answer they wrote from one the
-- appliance guessed on their behalf, let alone a well-evidenced inference from
-- a fabrication.
--
-- Confidence alone is a bare number; it says how sure without saying why. This
-- column holds the model's one-line account of WHAT EVIDENCE it used, captured
-- in the same structured generation as the answer and the score. It is shown
-- next to the confidence in the UI, so a low score is an explanation rather than
-- a shrug, and a high one is auditable against the user's actual data.
--
-- Deliberately not jsonb and not in `session_context`: it is a single
-- human-readable sentence rendered verbatim, and burying it in the context blob
-- would make it invisible to the read paths that render answers.
ALTER TABLE ci.answers
  ADD COLUMN IF NOT EXISTS answer_rationale TEXT;

COMMENT ON COLUMN ci.answers.answer_rationale IS
  'One-line, first-person account of the evidence behind an inferred answer, emitted by the model in the same structured generation as answer_text and answer_confidence. NULL for user-authored answers, for imported/observed rows, and for inferred rows written before this column existed. Cleared whenever a user edits the answer, which also flips answer_source back to ''user_input'' and clears answer_confidence — a corrected answer is the user''s, and carries no machine confidence.';

-- migrate:down
ALTER TABLE ci.answers DROP COLUMN IF EXISTS answer_rationale;
