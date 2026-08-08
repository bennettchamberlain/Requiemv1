-- migrate:up
-- Commerce / object-identity tables exist in schema ahead of product UI.
-- Mark them so operators don't mistake empty tables for missing migrations.

COMMENT ON TABLE ci.product_models IS
  'pre-implementation: product catalog identity; schema ready, product surface not shipped';
COMMENT ON TABLE ci.receipts IS
  'pre-implementation: purchase receipts; schema ready, product surface not shipped';
COMMENT ON TABLE ci.receipt_line_items IS
  'pre-implementation: receipt line items; schema ready, product surface not shipped';
COMMENT ON TABLE ci.object_observations IS
  'pre-implementation: observed physical objects; schema ready, product surface not shipped';

-- migrate:down
COMMENT ON TABLE ci.product_models IS NULL;
COMMENT ON TABLE ci.receipts IS NULL;
COMMENT ON TABLE ci.receipt_line_items IS NULL;
COMMENT ON TABLE ci.object_observations IS NULL;
