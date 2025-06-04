-- migrate:up
CREATE TABLE answers (
    id UUID PRIMARY KEY,

    rag_answer_1 TEXT,
    rag_answer_2 TEXT,
    rag_answer_3 TEXT,
    give_answer_1 TEXT,
    give_answer_2 TEXT,
    give_answer_3 TEXT,

    user_id UUID REFERENCES users(id),
    question_id UUID REFERENCES questions(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE answers;
