# Quickstart: Testing Double-Click to Open Model

## Prerequisites
- Authoring UI built: `npm run build:client`
- VS Code Extension running in Debug mode.

## Manual Test Steps

### Test 1: Selection Only (Single-Click)
1. Open the **Authoring Workbench**.
2. Navigate to the **Taxonomy** tab in the left sidebar.
3. Click a concept in the hierarchy tree.
4. **Expected Result**: 
   - The concept in the tree is highlighted.
   - The right column (workbench) does NOT update its content.

### Test 2: Model Opening (Double-Click)
1. Double-click a concept in the hierarchy tree.
2. **Expected Result**:
   - The concept model for the double-clicked entity opens in the workbench.
   - The tree might navigate to show the concept's context (if `viewTaxonomy` is triggered).

### Test 3: Multiple Selections
1. Click Concept A (highlights A).
2. Click Concept B (highlights B, A's highlight removed).
3. Workbench still shows whatever was open before Test 1.
4. Double-click Concept B.
5. Workbench updates to show Concept B.
