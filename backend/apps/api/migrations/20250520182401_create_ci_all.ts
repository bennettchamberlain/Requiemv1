import { Knex } from 'knex';

exports.up = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    CREATE TABLE Providers (
        id UUID PRIMARY KEY,
        coming_soon BOOLEAN,
        enabled BOOLEAN,
        login BOOLEAN,
        name TEXT,
        oauth_app UUID,
        remote_map_id UUID,
        sources JSONB
    );
    CREATE TABLE Connection (
        id UUID PRIMARY KEY,
        auth_status TEXT,
        authorized BOOLEAN,
        complete BOOLEAN,
        redirectURL TEXT,
        browser TEXT,
        enabled BOOLEAN,
        endpoint_date TIMESTAMP,
        frequency INTEGER,
        last_run TIMESTAMP,
        last_successful_run TIMESTAMP,
        name TEXT,
        oauth_app_name TEXT,
        permissions JSONB,
        provider_id UUID REFERENCES Providers(id),
        provider_name TEXT,
        remote_connection_id UUID
    );
    CREATE TABLE Person (
        id UUID PRIMARY KEY,
        address TEXT,
        street_address TEXT,
        street_address_2 TEXT,
        city TEXT,
        region TEXT,
        country TEXT,
        postal_code TEXT,
        avatar_url TEXT,
        external_avatar_url TEXT,
        type TEXT, -- Consider ENUM if fixed categories
        created TIMESTAMP,
        hidden BOOLEAN,
        tags UUID[],
        contact_ids UUID[]
    );
    CREATE TABLE Tag (
        _id UUID PRIMARY KEY,
        id TEXT,
        created TIMESTAMP,
        tag TEXT,
        share TEXT,
        passcode TEXT,
        updated TIMESTAMP,
        user_id UUID REFERENCES Person(id)
    );
    CREATE TABLE SavedSearch (
        id TEXT PRIMARY KEY,
        count INTEGER,
        favorited BOOLEAN,
        filters_data JSONB,
        filters_name TEXT,
        filters_type TEXT,
        hash TEXT,
        icon_color TEXT,
        last_run TIMESTAMP,
        name TEXT,
        query TEXT,
        user_id UUID REFERENCES Person(id)
    );
    CREATE TYPE content_type AS ENUM ('Photo', 'Video', 'Audio', 'Text', 'Code', 'Game', 'Web Page', 'File');
    CREATE TABLE Content (
        id TEXT PRIMARY KEY,
        connection_id UUID REFERENCES Connection(id),
        created TIMESTAMP,
        embed_content TEXT,
        embed_format TEXT,
        embed_thumbnail TEXT,
        hidden BOOLEAN,
        identifier TEXT,
        mimetype TEXT,
        price NUMERIC,
        provider_id UUID REFERENCES Providers(id),
        provider_name TEXT,
        remote_id TEXT,
        tags UUID[],
        text TEXT,
        title TEXT,
        type content_type,
        updated TIMESTAMP,
        url TEXT,
        user_id UUID REFERENCES Person(id)
    );
    CREATE TYPE thing_type AS ENUM (
        'Apparel', 'Footwear', 'Electronics', 'Furniture', 'Kitchenware and Cooking Equipment',
        'Vehicles', 'Books and Magazines', 'Jewelry and Accessories', 'Personal Care', 'Appliances',
        'Sporting and Fitness', 'Tools and Home Improvement Items', 'Toys and Games',
        'Decorations and Home Décor', 'Bedding', 'Instruments', 'Gardening', 'Outdoor and Camping Gear',
        'Art', 'Office', 'Pet Supplies', 'Food', 'Cleaning', 'Medical', 'Travel', 'Collectibles',
        'Eyewear', 'Watches', 'Photography', 'Organizational'
    );
    CREATE TABLE Thing (
        id TEXT PRIMARY KEY,
        connection UUID REFERENCES Connection(id),
        type thing_type,
        tags UUID[]
    );
    CREATE TYPE geo_format_type AS ENUM ('point', 'radius', 'triangle');
    CREATE TABLE Place (
        id UUID PRIMARY KEY,
        connection_id UUID REFERENCES Connection(id),
        estimated BOOLEAN,
        geo_format geo_format_type,
        geolocation JSONB,
        identifier TEXT,
        provider_id UUID REFERENCES Providers(id),
        tracked BOOLEAN,
        updated TIMESTAMP,
        uploaded BOOLEAN,
        user_id UUID REFERENCES Person(id),
        parent_place UUID REFERENCES Place(id),
        location_boundary JSONB,
        tags UUID[],
        type TEXT
    );
    CREATE TABLE Location (
        id UUID PRIMARY KEY,
        connection_id UUID REFERENCES Connection(id),
        datetime TIMESTAMP,
        estimated BOOLEAN,
        geo_format geo_format_type,
        geolocation JSONB,
        identifier TEXT,
        provider_id UUID REFERENCES Providers(id),
        tracked BOOLEAN,
        updated TIMESTAMP,
        uploaded BOOLEAN,
        user_id UUID REFERENCES Person(id),
        tags UUID[]
    );
    CREATE TABLE Contact (
        id TEXT PRIMARY KEY,
        avatar_url TEXT,
        connection_id UUID REFERENCES Connection(id),
        created TIMESTAMP,
        handle TEXT,
        hidden BOOLEAN,
        identifier TEXT,
        name TEXT,
        people_id UUID REFERENCES Person(id),
        provider_id UUID REFERENCES Providers(id),
        provider_name TEXT,
        remote_id TEXT,
        self BOOLEAN,
        tags UUID[],
        updated TIMESTAMP,
        user_id UUID REFERENCES Person(id)
    );
    CREATE TYPE event_type AS ENUM ('View', 'Play', 'Message', 'Comment', 'Create', 'Edit', 'Call', 'Visit', 'Travel', 'Eat', 'Transactions', 'Sleep', 'Exercise');
    CREATE TABLE Event (
        id UUID PRIMARY KEY,
        start TIMESTAMP,
        type event_type,
        user_id UUID REFERENCES Person(id),
        related_objects UUID[],
        created TIMESTAMP,
        updated TIMESTAMP,
        connection UUID REFERENCES Connection(id),
        provider UUID REFERENCES Providers(id),
        data_source TEXT,
        tags UUID[]
    );
  `);
};

exports.down = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    DROP TABLE EVENT;
    DROP TYPE event_type;
    DROP TABLE Contact;
    DROP TABLE Location;
    DROP TABLE Place;
    DROP TYPE geo_format_type;
    DROP TABLE Thing;
    DROP TYPE thing_type;
    DROP TABLE Content;
    DROP TYPE content_type;
    DROP TABLE SavedSearch;
    DROP TABLE Tag;
    DROP TABLE Person;
    DROP TABLE Connection;
    DROP TABLE Provider;
  `);
};
