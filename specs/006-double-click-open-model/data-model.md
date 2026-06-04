# Data Model: UI Focus State

## Entities

### Taxonomy Selection (Transient)

This represents the current selection state within the `taxonomyTree` directive. It is transient and not persisted to the backend.

| Field | Type | Description |
|-------|------|-------------|
| `selectedNodeId` | String (SCTID) | The ID of the concept currently highlighted by a single-click. |

## Relationships

- **One-to-One**: `TaxonomyTree` has one `selectedNodeId`.
- **Sync**: When a model is opened (double-click), `selectedNodeId` should be updated to match.

## Validation Rules

- Must be a valid SCTID or `null`.
- Must correspond to a visible node in the tree.
