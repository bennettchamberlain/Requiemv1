-- migrate:up
CREATE TABLE questions (
    id UUID PRIMARY KEY,

    category TEXT,
    text TEXT,
    example_answer_1 TEXT,
    example_answer_2 TEXT,
    example_answer_3 TEXT,

    user_id UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE question_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    question_id UUID REFERENCES questions(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE questions;
