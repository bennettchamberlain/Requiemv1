-- migrate:up
-- =================================================================
-- INVENTORY MANAGEMENT TABLE
-- =================================================================
-- Track owned objects and possessions

CREATE TABLE inventory (
    object_id UUID PRIMARY KEY DEFAULT gen_uuid_v7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Note: references users(id)
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Auto-detected owner
    object_entity_id UUID REFERENCES entities(entity_id), -- Object entity in knowledge graph
    
    -- Object identification
    name TEXT NOT NULL,
    description TEXT,
    category TEXT, -- 'electronics', 'books', 'clothing', 'tools', etc.
    subcategory TEXT,
    brand TEXT,
    model TEXT,
    identifier_codes JSONB DEFAULT '{}', -- Serial number, UPC, ISBN, EAN, etc.
    
    -- Financial
    purchase_price DECIMAL(10,2),
    current_value DECIMAL(10,2),
    currency TEXT DEFAULT 'USD',
    
    -- Temporal
    acquired_at TIMESTAMPTZ,
    warranty_expires_at TIMESTAMPTZ,
    disposed_at TIMESTAMPTZ, -- When lost/sold/given away
    disposal_method TEXT, -- 'sold', 'donated', 'lost', 'broken', 'gave_away'
    
    -- Usage tracking
    last_used_at TIMESTAMPTZ,
    usage_frequency TEXT, -- 'daily', 'weekly', 'monthly', 'rarely'
    usage_count INTEGER DEFAULT 0,
    
    -- Location
    location_description TEXT,
    storage_location TEXT,
    current_location_coordinates GEOGRAPHY(POINT, 4326),
    
    -- Condition
    condition TEXT CHECK (condition IN ('new', 'like_new', 'good', 'fair', 'poor', 'broken', 'n/a')),
    maintenance_needed BOOLEAN DEFAULT FALSE,
    maintenance_notes JSONB DEFAULT '{}',
    
    -- Digital items
    is_digital BOOLEAN DEFAULT FALSE,
    digital_location TEXT, -- URL, file path, account, etc.
    license_key TEXT,
    is_subscription BOOLEAN DEFAULT FALSE,
    subscription_expiration_date TIMESTAMPTZ,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    tags JSONB DEFAULT '{}',
    images JSONB DEFAULT '{}', -- Paths to images
    manuals JSONB DEFAULT '{}', -- Paths to manuals/documentation
    
    -- Semantic representation
    object_embedding vector(768),
    
    -- Relationships
    related_object_ids UUID[], -- Related items in inventory
    parent_object_id UUID REFERENCES inventory(object_id), -- For items that belong to other items
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for inventory management
CREATE INDEX inventory_user_idx ON inventory(user_id, created_at DESC);
CREATE INDEX inventory_owner_idx ON inventory(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX inventory_entity_idx ON inventory(object_entity_id) WHERE object_entity_id IS NOT NULL;
CREATE INDEX inventory_category_idx ON inventory(category, subcategory) WHERE category IS NOT NULL;
CREATE INDEX inventory_brand_model_idx ON inventory(brand, model) WHERE brand IS NOT NULL;
CREATE INDEX inventory_condition_idx ON inventory(condition) WHERE condition IS NOT NULL;
CREATE INDEX inventory_location_gist_idx ON inventory USING GIST (current_location_coordinates) WHERE current_location_coordinates IS NOT NULL;
CREATE INDEX inventory_parent_idx ON inventory(parent_object_id) WHERE parent_object_id IS NOT NULL;
CREATE INDEX inventory_warranty_idx ON inventory(warranty_expires_at) WHERE warranty_expires_at IS NOT NULL;
CREATE INDEX inventory_maintenance_idx ON inventory(maintenance_needed) WHERE maintenance_needed = TRUE;

-- migrate:down
-- Drop indexes and table
DROP INDEX IF EXISTS inventory_maintenance_idx;
DROP INDEX IF EXISTS inventory_warranty_idx;
DROP INDEX IF EXISTS inventory_parent_idx;
DROP INDEX IF EXISTS inventory_location_gist_idx;
DROP INDEX IF EXISTS inventory_condition_idx;
DROP INDEX IF EXISTS inventory_brand_model_idx;
DROP INDEX IF EXISTS inventory_category_idx;
DROP INDEX IF EXISTS inventory_entity_idx;
DROP INDEX IF EXISTS inventory_owner_idx;
DROP INDEX IF EXISTS inventory_user_idx;

DROP TABLE IF EXISTS inventory;
