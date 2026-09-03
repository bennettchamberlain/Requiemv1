# Summary data-pipeline contract tests

These tests pin the boundary from the database source registry through
aggregation and bounded prompt construction. They use recording database stubs
and do not require PostgreSQL or a model.

The suite verifies current sources are queried, retired/derived sources are
absent, query failures remain visible, activity counting follows list-valued
sources automatically, and prompt budgets preserve semantic content from both
early and late sources.
