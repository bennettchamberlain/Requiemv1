-- migrate:up

DROP TABLE IF EXISTS contact_tag;
DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS person_tag;
DROP TABLE IF EXISTS location_tag;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS place_tag;
DROP TABLE IF EXISTS places;
DROP TABLE IF EXISTS people;
DROP TABLE IF EXISTS event_history;
DROP TABLE IF EXISTS thing_tag;
DROP TABLE IF EXISTS things;

DROP TABLE IF EXISTS embeddings;
DROP TABLE IF EXISTS event_tag;



-- migrate:down
-- don't do this