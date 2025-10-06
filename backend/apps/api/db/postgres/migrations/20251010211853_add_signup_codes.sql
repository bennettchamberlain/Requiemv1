-- migrate:up
CREATE TABLE signup_code (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    signup_code TEXT NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- migrate:down
DROP TABLE signup_code;
