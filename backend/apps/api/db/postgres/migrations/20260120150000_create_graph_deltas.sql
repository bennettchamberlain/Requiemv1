-- migrate:up
-- =================================================================
-- GRAPH DELTAS - Change tracking for entities and relationships
-- =================================================================
-- Captures changes to the knowledge graph for history and summary generation

CREATE TABLE ci.graph_deltas (
    delta_id UUID PRIMARY KEY DEFAULT ci.gen_uuid_v7(),

    -- Reference to what changed (one or the other, not both)
    entity_id UUID REFERENCES ci.entities(entity_id) ON DELETE SET NULL,
    relationship_id UUID REFERENCES ci.relationships(relationship_id) ON DELETE SET NULL,

    -- Context (denormalized for query efficiency when source is deleted)
    node_type TEXT NOT NULL, -- 'entity' or 'relationship'
    entity_type TEXT, -- 'Person', 'Concept', etc. (for entities)
    relationship_type TEXT, -- 'KNOWS', 'WORKS_AT', etc. (for relationships)

    -- For relationships, capture the endpoints for context
    from_entity_id UUID,
    to_entity_id UUID,

    -- The actual change
    change_type TEXT NOT NULL, -- 'created', 'updated', 'archived', 'deleted', 'merged'
    changed_fields JSONB NOT NULL DEFAULT '{}', -- {"name": {"old": "Bob", "new": "Robert"}}
    change_source TEXT, -- 'user_edit', 'system_inference', 'merge_operation', 'provider_sync'
    change_reason TEXT, -- Optional explanation of why the change happened

    -- Link to batch summary when generated
    summary_id UUID REFERENCES ci.summaries(summary_id) ON DELETE SET NULL,

    -- Metadata
    changed_at TIMESTAMPTZ DEFAULT NOW(),
    changed_by_user_id UUID REFERENCES ci.users(id) ON DELETE SET NULL,
    owner_user_id UUID REFERENCES ci.users(id) ON DELETE SET NULL,

    -- Constraints
    CONSTRAINT valid_node_type CHECK (node_type IN ('entity', 'relationship')),
    CONSTRAINT valid_change_type CHECK (change_type IN ('created', 'updated', 'archived', 'deleted', 'merged')),
    CONSTRAINT has_valid_reference CHECK (
        (node_type = 'entity' AND entity_id IS NOT NULL AND relationship_id IS NULL) OR
        (node_type = 'relationship' AND relationship_id IS NOT NULL)
    )
);

-- Indexes for common queries
CREATE INDEX graph_deltas_entity_idx ON ci.graph_deltas(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX graph_deltas_relationship_idx ON ci.graph_deltas(relationship_id) WHERE relationship_id IS NOT NULL;
CREATE INDEX graph_deltas_owner_time_idx ON ci.graph_deltas(owner_user_id, changed_at DESC);
CREATE INDEX graph_deltas_unsummarized_idx ON ci.graph_deltas(owner_user_id, changed_at) WHERE summary_id IS NULL;
CREATE INDEX graph_deltas_node_type_idx ON ci.graph_deltas(node_type, change_type);
CREATE INDEX graph_deltas_entity_type_idx ON ci.graph_deltas(entity_type) WHERE entity_type IS NOT NULL;

-- =================================================================
-- TRIGGER: Capture entity changes
-- =================================================================
CREATE OR REPLACE FUNCTION ci.capture_entity_delta()
RETURNS TRIGGER AS $$
DECLARE
    v_change_type TEXT;
    v_changed_fields JSONB := '{}';
    v_change_source TEXT;
BEGIN
    -- Determine change type
    IF TG_OP = 'INSERT' THEN
        v_change_type := 'created';
        v_changed_fields := jsonb_build_object(
            'name', NEW.name,
            'description', NEW.description,
            'properties', NEW.properties
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Check if this is an archive operation
        IF OLD.is_archived = FALSE AND NEW.is_archived = TRUE THEN
            v_change_type := 'archived';
        ELSE
            v_change_type := 'updated';
        END IF;

        -- Build changed_fields with old/new values for fields that changed
        IF OLD.name IS DISTINCT FROM NEW.name THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
        END IF;
        IF OLD.description IS DISTINCT FROM NEW.description THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('description', jsonb_build_object('old', OLD.description, 'new', NEW.description));
        END IF;
        IF OLD.properties IS DISTINCT FROM NEW.properties THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('properties', jsonb_build_object('old', OLD.properties, 'new', NEW.properties));
        END IF;
        IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('is_active', jsonb_build_object('old', OLD.is_active, 'new', NEW.is_active));
        END IF;
        IF OLD.is_archived IS DISTINCT FROM NEW.is_archived THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('is_archived', jsonb_build_object('old', OLD.is_archived, 'new', NEW.is_archived));
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        v_change_type := 'deleted';
        v_changed_fields := jsonb_build_object(
            'name', OLD.name,
            'description', OLD.description,
            'properties', OLD.properties
        );
    END IF;

    -- Get change source from session variable if set
    v_change_source := current_setting('app.change_source', true);

    -- Insert the delta record
    INSERT INTO ci.graph_deltas (
        entity_id,
        node_type,
        entity_type,
        change_type,
        changed_fields,
        change_source,
        owner_user_id
    ) VALUES (
        COALESCE(NEW.entity_id, OLD.entity_id),
        'entity',
        COALESCE(NEW.entity_type, OLD.entity_type),
        v_change_type,
        v_changed_fields,
        v_change_source,
        COALESCE(NEW.owner_user_id, OLD.owner_user_id)
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entity_delta_trigger
    AFTER INSERT OR UPDATE OR DELETE ON ci.entities
    FOR EACH ROW
    EXECUTE FUNCTION ci.capture_entity_delta();

-- =================================================================
-- TRIGGER: Capture relationship changes
-- =================================================================
CREATE OR REPLACE FUNCTION ci.capture_relationship_delta()
RETURNS TRIGGER AS $$
DECLARE
    v_change_type TEXT;
    v_changed_fields JSONB := '{}';
    v_change_source TEXT;
    v_owner_user_id UUID;
BEGIN
    -- Determine change type
    IF TG_OP = 'INSERT' THEN
        v_change_type := 'created';
        v_changed_fields := jsonb_build_object(
            'strength', NEW.strength,
            'properties', NEW.properties,
            'is_bidirectional', NEW.is_bidirectional
        );
        v_owner_user_id := NEW.owner_user_id;
    ELSIF TG_OP = 'UPDATE' THEN
        v_change_type := 'updated';

        -- Build changed_fields with old/new values for fields that changed
        IF OLD.strength IS DISTINCT FROM NEW.strength THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('strength', jsonb_build_object('old', OLD.strength, 'new', NEW.strength));
        END IF;
        IF OLD.properties IS DISTINCT FROM NEW.properties THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('properties', jsonb_build_object('old', OLD.properties, 'new', NEW.properties));
        END IF;
        IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('is_active', jsonb_build_object('old', OLD.is_active, 'new', NEW.is_active));
        END IF;
        IF OLD.is_bidirectional IS DISTINCT FROM NEW.is_bidirectional THEN
            v_changed_fields := v_changed_fields || jsonb_build_object('is_bidirectional', jsonb_build_object('old', OLD.is_bidirectional, 'new', NEW.is_bidirectional));
        END IF;
        v_owner_user_id := NEW.owner_user_id;
    ELSIF TG_OP = 'DELETE' THEN
        v_change_type := 'deleted';
        v_changed_fields := jsonb_build_object(
            'strength', OLD.strength,
            'properties', OLD.properties,
            'is_bidirectional', OLD.is_bidirectional
        );
        v_owner_user_id := OLD.owner_user_id;
    END IF;

    -- Get change source from session variable if set
    v_change_source := current_setting('app.change_source', true);

    -- Insert the delta record
    INSERT INTO ci.graph_deltas (
        relationship_id,
        node_type,
        relationship_type,
        from_entity_id,
        to_entity_id,
        change_type,
        changed_fields,
        change_source,
        owner_user_id
    ) VALUES (
        COALESCE(NEW.relationship_id, OLD.relationship_id),
        'relationship',
        COALESCE(NEW.relationship_type, OLD.relationship_type),
        COALESCE(NEW.from_entity_id, OLD.from_entity_id),
        COALESCE(NEW.to_entity_id, OLD.to_entity_id),
        v_change_type,
        v_changed_fields,
        v_change_source,
        v_owner_user_id
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER relationship_delta_trigger
    AFTER INSERT OR UPDATE OR DELETE ON ci.relationships
    FOR EACH ROW
    EXECUTE FUNCTION ci.capture_relationship_delta();

-- migrate:down
DROP TRIGGER IF EXISTS relationship_delta_trigger ON ci.relationships;
DROP TRIGGER IF EXISTS entity_delta_trigger ON ci.entities;
DROP FUNCTION IF EXISTS ci.capture_relationship_delta();
DROP FUNCTION IF EXISTS ci.capture_entity_delta();
DROP TABLE IF EXISTS ci.graph_deltas;
