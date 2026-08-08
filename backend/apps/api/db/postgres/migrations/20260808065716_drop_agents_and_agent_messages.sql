-- migrate:up
-- Dead chat-agent tables (superseded by ci.threads / ci.messages). Summary
-- worker agent_registration is now a no-op so these can drop safely.
DROP TABLE IF EXISTS ci.agent_messages;
DROP TABLE IF EXISTS ci.agents;

-- migrate:down
-- Irreversible: original CREATE lived in 20250925151600 / 20250925152800.
SELECT 1;
