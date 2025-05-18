-- Enum Types
CREATE TYPE event_type_enum AS ENUM (
    'View', 'Play', 'Message', 'Comment', 'Create', 'Edit', 'Call', 'Visit', 'Travel', 'Eat', 'Transactions', 'Sleep', 'Exercise'
);

CREATE TYPE geo_format_enum AS ENUM (
    'point', 'radius', 'triangle'
);

CREATE TYPE place_type_enum AS ENUM (
    -- Add specific place types here based on application needs, e.g., 'Home', 'Work', 'Restaurant'
    -- The CSV mentions "Type of place. (Mentioned under location_boundary in CSV)" but doesn't list values.
    -- For now, leaving it empty or with a placeholder.
    'GenericPlace'
);

CREATE TYPE person_type_enum AS ENUM (
    'Person', 'User', 'Co-worker', 'Friend', 'Family', 'Spouse'
);

CREATE TYPE thing_type_enum AS ENUM (
    'Wearable', 'Appliance', 'Infrastructure', 'Media'
);

CREATE TYPE content_type_enum AS ENUM (
    'Photo', 'Video', 'Audio', 'Text', 'Code', 'Game', 'Web Page', 'File'
);

CREATE TYPE auth_status_enum AS ENUM (
    'authorized', 'requires_reauth'
    -- Add other statuses as needed
);

-- Table Creation
CREATE TABLE "Person" (
    "id" TEXT PRIMARY KEY,
    "address" TEXT,
    "street_address" TEXT,
    "street_address_2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "postal_code" TEXT,
    "avatar_url" TEXT,
    "contact_ids" TEXT[], -- Assuming array of FKs to a Contact table (if Contact.id is TEXT)
    "type" person_type_enum,
    "created" TIMESTAMP WITH TIME ZONE,
    "external_avatar_url" TEXT,
    "hidden" BOOLEAN,
    "tags" TEXT[] -- Assuming array of tag strings or FKs to a Tag table
);

CREATE TABLE "Providers" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "coming_soon" BOOLEAN,
    "enabled" BOOLEAN,
    "login" BOOLEAN,
    "name" TEXT NOT NULL,
    "oauth_app" JSONB, -- Assuming Buffer is for JSON config
    "remote_map_id" TEXT, -- Assuming Buffer is TEXT
    "sources" JSONB
);

CREATE TABLE "Connection" (
    "id" TEXT PRIMARY KEY,
    "auth_status" auth_status_enum,
    "authorized" BOOLEAN,
    "complete" BOOLEAN,
    "redirectURL" TEXT,
    "browser" TEXT,
    "enabled" BOOLEAN,
    "endpoint_date" TIMESTAMP WITH TIME ZONE,
    "frequency" INTEGER,
    "last_run" TIMESTAMP WITH TIME ZONE,
    "last_successful_run" TIMESTAMP WITH TIME ZONE,
    "name" TEXT,
    "oauth_app_name" TEXT,
    "permissions" JSONB,
    "provider_id" UUID REFERENCES "Providers"("id"), -- Assuming FK to Providers.id
    "provider_name" TEXT,
    "remote_connection_id" TEXT -- Assuming Buffer is TEXT
);

CREATE TABLE "Event" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "type" event_type_enum,
    "user_id" TEXT REFERENCES "Person"("id"),
    "related_objects" UUID[], -- Assuming array of UUIDs, need context for what objects these reference
    "created" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updated" TIMESTAMP WITH TIME ZONE,
    "connection" TEXT REFERENCES "Connection"("id"),
    "provider" UUID REFERENCES "Providers"("id"),
    "data_source" TEXT
);

CREATE TABLE "Place" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "connection_id" TEXT REFERENCES "Connection"("id"),
    "estimated" BOOLEAN,
    "geo_format" geo_format_enum,
    "geolocation" JSONB, -- GeoJSON stored as JSONB
    "identifier" TEXT,
    "provider_id" UUID REFERENCES "Providers"("id"),
    "tracked" BOOLEAN,
    "updated" TIMESTAMP WITH TIME ZONE,
    "uploaded" BOOLEAN,
    "user_id" TEXT REFERENCES "Person"("id"), -- Assuming Buffer/(FK to Person) means FK to Person.id
    "parent_place" UUID REFERENCES "Place"("id"),
    "location_boundary" JSONB, -- Array of Location objects/coordinates
    "tags" TEXT[], -- Assuming array of tag strings or FKs
    "type" place_type_enum
);

CREATE TABLE "Location" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "connection_id" TEXT REFERENCES "Connection"("id"),
    "datetime" TIMESTAMP WITH TIME ZONE,
    "estimated" BOOLEAN,
    "geo_format" geo_format_enum,
    "geolocation" JSONB, -- Hash/JSON for lat, long, alt, orientation
    "identifier" TEXT,
    "provider_id" UUID REFERENCES "Providers"("id"),
    "tracked" BOOLEAN,
    "updated" TIMESTAMP WITH TIME ZONE,
    "uploaded" BOOLEAN,
    "user_id" TEXT REFERENCES "Person"("id"), -- Assuming Buffer/(FK to Person) means FK to Person.id
    "tags" TEXT[] -- Assuming array of tag strings or FKs
);

CREATE TABLE "Contact" (
    "id" TEXT PRIMARY KEY, -- Application-level/external Primary Key
    "avatar_url" TEXT,
    "connection_id" TEXT REFERENCES "Connection"("id"), -- Assuming Buffer/(FK to Connection)
    "created" TIMESTAMP WITH TIME ZONE,
    "handle" TEXT,
    "hidden" BOOLEAN,
    "identifier" TEXT,
    "name" TEXT,
    "people_id" TEXT REFERENCES "Person"("id"), -- Assuming Buffer/(FK to Person)
    "provider_id" UUID REFERENCES "Providers"("id"), -- Assuming Buffer/(FK to Providers)
    "provider_name" TEXT,
    "remote_id" TEXT,
    "self" BOOLEAN,
    "tags" TEXT[], -- Assuming array of tag strings or FKs
    "updated" TIMESTAMP WITH TIME ZONE,
    "user_id" TEXT REFERENCES "Person"("id") -- Assuming Buffer/(FK to Person)
);

CREATE TABLE "Thing" (
    "id" TEXT PRIMARY KEY, -- Application-level/external Primary Key
    "tags" TEXT[], -- Assuming array of tag strings or FKs
    "connection" TEXT REFERENCES "Connection"("id"), -- Assuming Buffer/(FK to Connection)
    "type" thing_type_enum
);

CREATE TABLE "Content" (
    "id" TEXT PRIMARY KEY, -- Application-level/external Primary Key
    "connection_id" TEXT REFERENCES "Connection"("id"),
    "created" TIMESTAMP WITH TIME ZONE,
    "embed_content" TEXT,
    "embed_format" TEXT,
    "embed_thumbnail" TEXT,
    "hidden" BOOLEAN,
    "identifier" TEXT,
    "mimetype" TEXT,
    "price" NUMERIC,
    "provider_id" UUID REFERENCES "Providers"("id"), -- Assuming Buffer/(FK to Providers)
    "provider_name" TEXT,
    "remote_id" TEXT,
    "tags" TEXT[], -- Assuming array of tag strings or FKs
    "text" TEXT,
    "title" TEXT,
    "type" content_type_enum,
    "updated" TIMESTAMP WITH TIME ZONE,
    "url" TEXT,
    "user_id" TEXT REFERENCES "Person"("id") -- Assuming Buffer/(FK to Person)
);

CREATE TABLE "Search" (
    "id" TEXT PRIMARY KEY, -- Application-level/external Primary Key
    "count" INTEGER,
    "favorited" BOOLEAN,
    "filters_data" JSONB,
    "filters_name" TEXT,
    "filters_type" TEXT,
    "hash" TEXT,
    "icon_color" TEXT,
    "last_run" TIMESTAMP WITH TIME ZONE,
    "name" TEXT,
    "query" TEXT,
    "user_id" TEXT REFERENCES "Person"("id")
);

CREATE TABLE "Tag" (
    "_id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Internal Primary Key (Buffer implies it could be binary or UUID)
    "id" TEXT UNIQUE, -- Application-level/external Primary Key, should be unique
    "created" TIMESTAMP WITH TIME ZONE,
    "tag" TEXT NOT NULL,
    "share" TEXT,
    "passcode" TEXT,
    "updated" TIMESTAMP WITH TIME ZONE,
    "user_id" TEXT REFERENCES "Person"("id") -- Assuming Buffer/(FK to Person)
);

