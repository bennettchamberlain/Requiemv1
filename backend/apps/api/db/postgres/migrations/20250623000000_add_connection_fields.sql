-- migrate:up
ALTER TABLE connections ADD COLUMN active BOOLEAN DEFAULT true;
ALTER TABLE connections ADD COLUMN clientid TEXT;
ALTER TABLE connections ADD COLUMN clientkey TEXT;
ALTER TABLE connections ADD COLUMN clientsecret TEXT;
ALTER TABLE connections ADD COLUMN clienttoken TEXT;
ALTER TABLE connections ADD COLUMN schedule TEXT;

-- migrate:down
ALTER TABLE connections DROP COLUMN active;
ALTER TABLE connections DROP COLUMN clientid;
ALTER TABLE connections DROP COLUMN clientkey;
ALTER TABLE connections DROP COLUMN clientsecret;
ALTER TABLE connections DROP COLUMN clienttoken;
ALTER TABLE connections DROP COLUMN schedule;
