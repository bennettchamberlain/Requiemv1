import { Knex } from 'knex';

exports.up = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    -- Drop all tables and types if they exist to avoid conflicts
    drop table if exists event cascade;
    drop table if exists contact cascade;
    drop table if exists location cascade;
    drop table if exists place cascade;
    drop table if exists thing cascade;
    drop table if exists content cascade;
    drop table if exists savedsearch cascade;
    drop table if exists tag cascade;
    drop table if exists person cascade;
    drop table if exists connection cascade;
    drop table if exists provider cascade;
    drop type if exists event_type cascade;
    drop type if exists content_type cascade;
    drop type if exists thing_type cascade;
    drop type if exists geo_format_type cascade;
    
    create table provider (
        id uuid primary key,
        coming_soon boolean,
        enabled boolean,
        login boolean,
        name text,
        oauth_app uuid,
        remote_map_id uuid,
        sources jsonb
    );
    create table connection (
        id uuid primary key,
        auth_status text,
        authorized boolean,
        complete boolean,
        redirecturl text,
        browser text,
        enabled boolean,
        endpoint_date timestamp,
        frequency integer,
        last_run timestamp,
        last_successful_run timestamp,
        name text,
        oauth_app_name text,
        permissions jsonb,
        provider_id uuid references provider(id),
        provider_name text,
        remote_connection_id uuid
    );
    create table person (
        id uuid primary key,
        first_name text,
        last_name text,
        address text,
        street_address text,
        street_address_2 text,
        city text,
        region text,
        country text,
        postal_code text,
        avatar_url text,
        external_avatar_url text,
        type text,
        created timestamp,
        hidden boolean,
        tags uuid[],
        contact_ids uuid[],
        gender text,
        middle_name text
    );
    create table tag (
        _id uuid primary key,
        id text,
        created timestamp,
        tag text,
        share text,
        passcode text,
        updated timestamp,
        user_id uuid references person(id)
    );
    create table savedsearch (
        id text primary key,
        count integer,
        favorited boolean,
        filters_data jsonb,
        filters_name text,
        filters_type text,
        hash text,
        icon_color text,
        last_run timestamp,
        name text,
        query text,
        user_id uuid references person(id)
    );
    create type content_type as enum ('Photo', 'Video', 'Audio', 'Text', 'Code', 'Game', 'Web Page', 'File');
    create table content (
        id text primary key,
        connection_id uuid references connection(id),
        created timestamp,
        embed_content text,
        embed_format text,
        embed_thumbnail text,
        hidden boolean,
        identifier text,
        mimetype text,
        price numeric,
        provider_id uuid references provider(id),
        provider_name text,
        remote_id text,
        tags uuid[],
        text text,
        title text,
        type content_type,
        updated timestamp,
        url text,
        user_id uuid references person(id)
    );
    create type thing_type as enum (
        'Apparel', 'Footwear', 'Electronics', 'Furniture', 'Kitchenware and Cooking Equipment',
        'Vehicles', 'Books and Magazines', 'Jewelry and Accessories', 'Personal Care', 'Appliances',
        'Sporting and Fitness', 'Tools and Home Improvement Items', 'Toys and Games',
        'Decorations and Home Décor', 'Bedding', 'Instruments', 'Gardening', 'Outdoor and Camping Gear',
        'Art', 'Office', 'Pet Supplies', 'Food', 'Cleaning', 'Medical', 'Travel', 'Collectibles',
        'Eyewear', 'Watches', 'Photography', 'Organizational'
    );
    create table thing (
        id text primary key,
        connection uuid references connection(id),
        type thing_type,
        tags uuid[]
    );
    create type geo_format_type as enum ('point', 'radius', 'triangle');
    create table place (
        id uuid primary key,
        connection_id uuid references connection(id),
        estimated boolean,
        geo_format geo_format_type,
        geolocation jsonb,
        identifier text,
        provider_id uuid references provider(id),
        tracked boolean,
        updated timestamp,
        uploaded boolean,
        user_id uuid references person(id),
        parent_place uuid references place(id),
        location_boundary jsonb,
        tags uuid[],
        type text
    );
    create table location (
        id uuid primary key,
        connection_id uuid references connection(id),
        datetime timestamp,
        estimated boolean,
        geo_format geo_format_type,
        geolocation jsonb,
        identifier text,
        provider_id uuid references provider(id),
        tracked boolean,
        updated timestamp,
        uploaded boolean,
        user_id uuid references person(id),
        tags uuid[]
    );
    create table contact (
        id text primary key,
        avatar_url text,
        connection_id uuid references connection(id),
        created timestamp,
        handle text,
        hidden boolean,
        identifier text,
        name text,
        people_id uuid references person(id),
        provider_id uuid references provider(id),
        provider_name text,
        remote_id text,
        self boolean,
        tags uuid[],
        updated timestamp,
        user_id uuid references person(id)
    );
    create type event_type as enum ('View', 'Play', 'Message', 'Comment', 'Create', 'Edit', 'Call', 'Visit', 'Travel', 'Eat', 'Transactions', 'Sleep', 'Exercise');
    create table event (
        id uuid primary key,
        start timestamp,
        type event_type,
        user_id uuid references person(id),
        related_objects uuid[],
        created timestamp,
        updated timestamp,
        connection uuid references connection(id),
        provider uuid references provider(id),
        data_source text,
        tags uuid[]
    );
  `);
};

exports.down = async function (knex: Knex): Promise<void> {
  return knex.raw(`
    drop table if exists event;
    drop type if exists event_type;
    drop table if exists contact;
    drop table if exists location;
    drop table if exists place;
    drop type if exists geo_format_type;
    drop table if exists thing;
    drop type if exists thing_type;
    drop table if exists content;
    drop type if exists content_type;
    drop table if exists savedsearch;
    drop table if exists tag;
    drop table if exists person;
    drop table if exists connection;
    drop table if exists provider;
  `);
};
