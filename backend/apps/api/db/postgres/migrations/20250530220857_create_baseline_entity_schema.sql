-- migrate:up
CREATE TABLE events (
    id UUID PRIMARY KEY,

    type TEXT,
    name TEXT,
    description TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,

    external_id TEXT,
    source_url TEXT,
    source_data JSONB,

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

CREATE TABLE people (
    id UUID PRIMARY KEY,

    type TEXT,
    first_name TEXT,
    last_name TEXT,
    gender TEXT,
    address TEXT,
    street_address TEXT,
    street_address_2 TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    postal_code TEXT,
    avatar_url TEXT, -- The icon used by our system to render the user, i.e. profile image

    external_id TEXT,
    source_url TEXT,
    source_data JSONB,

    user_id UUID REFERENCES users(id),
    connection_id UUID REFERENCES connections(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE person_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    person_id UUID REFERENCES people(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Can have multiple people at an event.
-- Note, this is NOT contacts.
CREATE TABLE event_person (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    event_id UUID REFERENCES events(id) NOT NULL,
    person_id UUID REFERENCES people(id) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- When we create a contact, if we cannot associate it with a person we will create a new person.
CREATE TABLE contacts (
    id UUID PRIMARY KEY,

    type TEXT,
    avatar_url TEXT,
    handle TEXT,
    identifier TEXT,

    external_id TEXT,
    source_url TEXT,
    source_data JSONB,

    user_id UUID REFERENCES users(id),
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

    type TEXT,
    title TEXT,
    text TEXT,
    url TEXT,
    mimetype TEXT,

    external_id TEXT,
    source_url TEXT,
    source_data JSONB,

    user_id UUID REFERENCES users(id),
    event_id UUID REFERENCES events(id),

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
    name TEXT,
    description TEXT,

    external_id TEXT,
    source_url TEXT,
    source_data JSONB,

    user_id UUID REFERENCES users(id),
    event_id UUID REFERENCES events(id),

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
    name TEXT,
    geo_format TEXT,
    geolocation JSONB,
    location_boundary JSONB,
    estimated BOOLEAN,
    tracked BOOLEAN,
    uploaded BOOLEAN,

    parent_id UUID REFERENCES places(id),
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

    identifier TEXT,
    datetime TIMESTAMPTZ,
    geo_format TEXT,
    geolocation JSONB,
    estimated BOOLEAN,
    tracked BOOLEAN,
    uploaded BOOLEAN,

    place_id UUID REFERENCES places(id),
    user_id UUID REFERENCES users(id),
    connection_id UUID REFERENCES connections(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE location_tag (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    location_id UUID REFERENCES locations(id) NOT NULL,
    tag_id UUID REFERENCES tags(id) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- migrate:down
DROP TABLE events;
DROP TABLE event_tag;
DROP TABLE people;
DROP TABLE people_tag;
DROP TABLE contacts;
DROP TABLE content;
DROP TABLE content_tag;
DROP TABLE things;
DROP TABLE thing_tag;
DROP TABLE places;
DROP TABLE place_tag;
DROP TABLE locations;
DROP TABLE location_tag;
