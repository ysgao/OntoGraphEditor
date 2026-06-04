# Research: Hierarchy Interaction Patterns

## Findings

### 1. Current Click Handling
- **File**: `apps/authoring-ui-vscode/app/shared/taxonomy-tree/taxonomyTree.js`
- **Logic**: Uses a `clickCt` counter on the `node` object.
  - `clickCt === 1`: Starts a 500ms `$timeout`. If no other click occurs, it broadcasts `editConcept`.
  - `clickCt > 1`: Immediately broadcasts `viewTaxonomy`.
- **Effect**: 
  - Single-click opens the model in the workbench.
  - Double-click navigates the tree to that concept (sets it as root/focus).

### 2. Events Involved
- `editConcept`: Listened to by `EditCtrl`. Triggers loading and displaying the concept model in the right column.
- `viewTaxonomy`: Listened to by `taxonomyPanelCtrl`. Triggers re-rendering of the tree to show the selected concept and its ancestry.
- `conceptFocused`: Listened to by `EditCtrl`. Currently only updates a local `selectedConcept` variable for keyboard shortcuts.

### 3. Highlight Logic
- **File**: `apps/authoring-ui-vscode/app/shared/taxonomy-tree/taxonomyTree.html`
- **Code**: `ng-class="[{'highlight' : node.conceptId === concept.conceptId}]"`
- **Constraint**: `concept` is bound to the parent's `rootConcept`. Updating it triggers `initialize()` in `taxonomyTree.js`, which re-renders the tree.

## Decisions

### D-001: Event Swapping
We will move `editConcept` from the single-click timeout to the double-click handler. This ensures models only open on explicit double-click.

### D-002: Selection Highlight
To allow "selection" on single-click without re-rendering the whole tree, we will introduce a `selectedNodeId` local variable in the `taxonomyTree` scope. The template will be updated to highlight nodes that match either `concept.conceptId` (the tree root) or `selectedNodeId` (the clicked node).

### D-003: Tree Navigation
We will keep `viewTaxonomy` on double-click. This means double-clicking will both open the model AND navigate the tree to that concept (standard behavior in this app).

## Alternatives Considered
- **Moving `viewTaxonomy` to single-click**: Rejected because it causes tree re-rendering on every click, which is disruptive when browsing.
- **Using `ng-dblclick`**: Rejected due to known conflicts with `ng-click` in AngularJS 1.4.x and potential interference with `angular-ui-tree` selection logic.
