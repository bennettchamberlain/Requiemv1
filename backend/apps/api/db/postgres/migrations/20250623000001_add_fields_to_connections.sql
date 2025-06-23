-- migrate:up
ALTER TABLE connections 
ADD COLUMN clientid TEXT,
ADD COLUMN clientkey TEXT,
ADD COLUMN clientsecret TEXT,
ADD COLUMN schedule TEXT;

-- migrate:down
ALTER TABLE connections 
DROP COLUMN clientid,
DROP COLUMN clientkey,
DROP COLUMN clientsecret,
DROP COLUMN schedule;
