import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';

const OWL_THING = 'http://www.w3.org/2002/07/owl#Thing';

export class ClassTreeItem extends vscode.TreeItem {
  constructor(
    public readonly iri: string,
    public readonly baseLabel: string,
    public readonly prefix: string,
    hasChildren: boolean,
    public readonly isRoot = false,
    autoExpand = false,
  ) {
    super(prefix + baseLabel, hasChildren
      ? (autoExpand ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
      : vscode.TreeItemCollapsibleState.None);
    this.id = `class:${iri}`;
    this.tooltip = vscode.workspace.getConfiguration('ontograph').get<boolean>('display.showIriOnHover', false) ? iri : '';
    this.contextValue = 'owlEntity';
  }
}

export class ClassHierarchyProvider implements vscode.TreeDataProvider<ClassTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ClassTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private model: OntologyModel | undefined;
  /** parent IRI → child IRIs (asserted; sorted lazily on first display) */
  private childrenOf = new Map<string, string[]>();
  /** child IRI → parent IRIs (asserted; sorted lazily on first display) */
  private parentsOf = new Map<string, string[]>();
  /** Keys of childrenOf/parentsOf arrays already sorted. Cleared on buildIndex. */
  private sorted = new Set<string>();
  private focusIri: string | undefined = OWL_THING;
  private preferredLang = 'en';
  private readonly collator = new Intl.Collator(undefined, { sensitivity: 'base' });

  setModel(model: OntologyModel, preferredLang = 'en'): void {
    const oldFocus = this.focusIri;
    this.model = model;
    this.preferredLang = preferredLang;

    // Restore focus if it still exists in the model, else fall back to Thing
    if (oldFocus && (oldFocus === OWL_THING || this.model.classes.has(oldFocus))) {
      this.focusIri = oldFocus;
    } else {
      this.focusIri = OWL_THING;
    }

    this.buildIndex();
    this._onDidChangeTreeData.fire();
  }

  setFocus(iri: string): void {
    if (this.focusIri === iri) { return; }
    this.focusIri = iri;
    this._onDidChangeTreeData.fire();
  }

  private buildIndex(): void {
    this.childrenOf.clear();
    this.parentsOf.clear();
    this.sorted.clear();
    if (!this.model) { return; }

    for (const cls of this.model.classes.values()) {
      const explicitParents = new Set(cls.superClassIris);
      for (const expr of cls.superClassExpressions ?? []) {
        for (const p of extractTopLevelNamedClasses(expr, this.model.classes)) {
          explicitParents.add(p);
        }
      }
      for (const expr of cls.equivalentClassExpressions ?? []) {
        for (const p of extractTopLevelNamedClasses(expr, this.model.classes)) {
          explicitParents.add(p);
        }
      }

      const parents = explicitParents.size > 0 ? Array.from(explicitParents) : [OWL_THING];
      this.parentsOf.set(cls.iri, parents);

      for (const parent of parents) {
        const siblings = this.childrenOf.get(parent) ?? [];
        siblings.push(cls.iri);
        this.childrenOf.set(parent, siblings);
      }
    }
    // Sorting is deferred to getChildren() — only the focused node's arrays are
    // sorted, on first display, instead of all N arrays at setModel time.
  }

  private ensureSorted(key: string, iris: string[]): void {
    if (this.sorted.has(key) || iris.length < 2) { return; }
    this.sorted.add(key);
    // Pre-compute labels once so the comparator doesn't call getLabel O(N log N) times.
    const keyed = iris.map(iri => {
      const cls = this.model!.classes.get(iri);
      return { iri, key: cls ? getLabel(cls, this.preferredLang) : iri };
    });
    keyed.sort((a, b) => this.collator.compare(a.key, b.key));
    for (let i = 0; i < iris.length; i++) { iris[i] = keyed[i].iri; }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ClassTreeItem): vscode.TreeItem {
    let icon = '▫';

    if (element.iri === this.focusIri) {
      icon = '◉';
    } else {
      const parents = this.parentsOf.get(this.focusIri ?? '');
      if (parents?.includes(element.iri)) {
        icon = '^';
      } else {
        const hasChildren = (this.childrenOf.get(element.iri)?.length ?? 0) > 0;
        if (hasChildren) {
          icon = ' › ';
        }
      }
    }

    // Indented label with a larger icon and no extra role text
    element.label = `${element.prefix}${icon} ${element.baseLabel}`;
    element.description = undefined; 
    element.iconPath = undefined; 

    return element;
  }

  getChildren(element?: ClassTreeItem): ClassTreeItem[] {
    if (!this.model) { return []; }

    // If we have an element, it's a neighborhood node, which has no children in this view
    if (element) { return []; }

    // Root level: if no focus, show owl:Thing root (legacy behavior or initial state)
    if (!this.focusIri) {
      const childCount = (this.childrenOf.get(OWL_THING)?.length ?? 0);
      return [new ClassTreeItem(OWL_THING, 'owl:Thing', '', childCount > 0, true, childCount > 0)];
    }

    // Neighborhood view: [parents] + [focus] + [children]
    const result: ClassTreeItem[] = [];

    // Lazily sort parent and child arrays for the current focus on first display.
    const parentIris = this.parentsOf.get(this.focusIri) ?? [];
    this.ensureSorted(`p:${this.focusIri}`, parentIris);
    const childIrisForSort = this.childrenOf.get(this.focusIri) ?? [];
    this.ensureSorted(`c:${this.focusIri}`, childIrisForSort);

    // 1. Parents (Level 0)
    for (const iri of parentIris) {
      if (iri === OWL_THING) { continue; }
      const item = this.makeItem(iri, "");
      if (item) {
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        result.push(item);
      }
    }

    // 2. Focus (Level 1, unless Thing)
    const focusPrefix = (this.focusIri === OWL_THING) ? "" : "  ";
    const focusItem = this.makeItem(this.focusIri, focusPrefix);
    if (focusItem) {
      focusItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
      result.push(focusItem);
    }

    // 3. Children (Level 2, or Level 1 if Thing is focus)
    const childPrefix = (this.focusIri === OWL_THING) ? "  " : "    ";
    for (const iri of childIrisForSort) {
      const item = this.makeItem(iri, childPrefix);
      if (item) {
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        result.push(item);
      }
    }

    return result;
  }

  makeItem(iri: string, prefix = ""): ClassTreeItem | undefined {
    if (!this.model) { return undefined; }
    const cls = this.model.classes.get(iri);
    if (!cls && iri !== OWL_THING) { return undefined; }
    const baseLabel = cls ? getLabel(cls, this.preferredLang) : (iri === OWL_THING ? 'owl:Thing' : iri);
    return new ClassTreeItem(
      iri,
      baseLabel,
      prefix,
      false, // Children handled by neighborhood logic
    );
  }

  getParent(_element: ClassTreeItem): ClassTreeItem | undefined {
    // In flat neighborhood view, all visible items are roots.
    // Returning undefined ensures reveal() can find them among the top-level children.
    return undefined;
  }
}

function extractTopLevelNamedClasses(expr: string, knownClasses: Map<string, any>): string[] {
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (depth === 0 && expr.startsWith(' or ', i)) return [];
  }
  
  const result: string[] = [];
  let currentConjunct = '';
  depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    
    if (depth === 0 && expr.startsWith(' and ', i)) {
      result.push(currentConjunct.trim());
      currentConjunct = '';
      i += 4;
    } else {
      currentConjunct += char;
    }
  }
  if (currentConjunct) result.push(currentConjunct.trim());
  
  const namedClasses: string[] = [];
  for (const c of result) {
    if (!c.includes(' ') && !c.includes('(') && knownClasses.has(c)) {
      namedClasses.push(c);
    }
  }
  return namedClasses;
}
