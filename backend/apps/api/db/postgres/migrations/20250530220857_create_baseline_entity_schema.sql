-- migrate:up
CREATE TABLE people (
    id UUID PRIMARY KEY,

    first_name TEXT,
    middle_name TEXT,
    last_name TEXT,
    gender TEXT,
    address TEXT,
    street_address TEXT,
    street_address_2 TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    postal_code TEXT,
    avatar_url TEXT,
    type TEXT,

    user_id UUID REFERENCES users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE people_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    person_id UUID REFERENCES people(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contacts (
    id UUID PRIMARY KEY,

    external_id TEXT,

    name TEXT,
    avatar_url TEXT,

    connection_id UUID REFERENCES connections(id),
    person_id UUID REFERENCES people(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE contact_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    contact_id UUID REFERENCES contacts(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE content (
    id UUID PRIMARY KEY,

    url TEXT,

    embed_content TEXT,
    embed_format TEXT,
    embed_thumbnail TEXT,
    hidden BOOLEAN,
    identifier TEXT,
    mimetype TEXT,
    price numeric,

    provider_name TEXT,
    remote_id TEXT,
    text TEXT,
    title TEXT,
    type TEXT,

    user_id UUID REFERENCES users(id),
    connection_id UUID REFERENCES connections(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE content_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    content_id UUID REFERENCES content(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE things (
    id UUID PRIMARY KEY,

    type TEXT,

    user_id UUID REFERENCES users(id),
    connection_id UUID REFERENCES connections(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE thing_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    thing_id UUID REFERENCES things(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE places (
    id UUID PRIMARY KEY,

    type TEXT,
    geo_format TEXT,
    geolocation JSONB,
    identifier TEXT,
    location_boundary JSONB,
    estimated BOOLEAN,
    tracked BOOLEAN,
    uploaded BOOLEAN,

    user_id UUID REFERENCES users(id),
    connection_id UUID REFERENCES connections(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE place_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    place_id UUID REFERENCES places(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE locations (
    id UUID PRIMARY KEY,

    datetime TIMESTAMPTZ,
    geo_format TEXT,
    geolocation JSONB,
    identifier TEXT,
    estimated BOOLEAN,
    tracked BOOLEAN,
    uploaded BOOLEAN,

    user_id UUID REFERENCES users(id),
    connection_id UUID REFERENCES connections(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE events (
    id UUID PRIMARY KEY,

    type TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,

    user_id UUID REFERENCES users(id),
    connection_id UUID REFERENCES connections(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE event_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    event_id UUID REFERENCES events(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS people_tag;
DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS contact_tag;
DROP TABLE IF EXISTS content;
DROP TABLE IF EXISTS content_tag;
DROP TABLE IF EXISTS things;
DROP TABLE IF EXISTS thing_tag;
DROP TABLE IF EXISTS places;
DROP TABLE IF EXISTS place_tag;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS locatio;
DROP TABLE IF EXISTS locations;
