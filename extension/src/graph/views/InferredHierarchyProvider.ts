import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';

const OWL_THING = 'http://www.w3.org/2002/07/owl#Thing';

export class InferredClassTreeItem extends vscode.TreeItem {
  constructor(
    public readonly iri: string,
    public readonly baseLabel: string,
    public readonly prefix: string,
    hasChildren: boolean,
  ) {
    super(prefix + baseLabel, hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
    this.id = `inferred:${iri}`;
    this.tooltip = vscode.workspace.getConfiguration('ontograph').get<boolean>('display.showIriOnHover', false) ? iri : '';
    this.contextValue = 'owlEntity';
  }
}

export class InferredHierarchyProvider implements vscode.TreeDataProvider<InferredClassTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<InferredClassTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private model: OntologyModel | undefined;
  private preferredLang = 'en';
  private readonly collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  /** parent IRI → child IRIs pre-sorted by label */
  private sortedSubClasses = new Map<string, string[]>();
  /** child IRI → parent IRIs pre-sorted by label */
  private sortedSuperClasses = new Map<string, string[]>();
  private focusIri: string | undefined = OWL_THING;

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

    this.buildSortedIndex();
    this._onDidChangeTreeData.fire();
  }

  setFocus(iri: string): void {
    if (this.focusIri === iri) { return; }
    this.focusIri = iri;
    this._onDidChangeTreeData.fire();
  }

  private buildSortedIndex(): void {
    this.sortedSubClasses.clear();
    this.sortedSuperClasses.clear();
    if (!this.model?.isClassified) { return; }

    // First, populate all super/sub relations
    for (const [parent, children] of this.model.inferredSubClasses) {
      this.sortedSubClasses.set(parent, Array.from(children));
      for (const child of children) {
        const parents = this.sortedSuperClasses.get(child) ?? [];
        parents.push(parent);
        this.sortedSuperClasses.set(child, parents);
      }
    }

    // Then sort them
    for (const [, children] of this.sortedSubClasses) {
      this.sortIris(children);
    }
    for (const [, parents] of this.sortedSuperClasses) {
      this.sortIris(parents);
    }
  }

  private sortIris(iris: string[]): void {
    if (!this.model) { return; }
    iris.sort((a, b) => {
      const ca = this.model!.classes.get(a);
      const cb = this.model!.classes.get(b);
      return this.collator.compare(
        ca ? getLabel(ca, this.preferredLang) : a,
        cb ? getLabel(cb, this.preferredLang) : b,
      );
    });
  }

  refresh(): void {
    this.buildSortedIndex();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: InferredClassTreeItem): vscode.TreeItem {
    let icon = '▫';

    if (element.iri === this.focusIri) {
      icon = '◉';
    } else {
      const parents = this.sortedSuperClasses.get(this.focusIri ?? '');
      if (parents?.includes(element.iri)) {
        icon = '^';
      } else {
        const hasChildren = (this.sortedSubClasses.get(element.iri)?.length ?? 0) > 0;
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

  getParent(_element: InferredClassTreeItem): InferredClassTreeItem | undefined {
    // In flat neighborhood view, all visible items are roots.
    return undefined;
  }

  makeItem(iri: string, prefix = ""): InferredClassTreeItem | undefined {
    if (!this.model?.isClassified) { return undefined; }
    const cls = this.model.classes.get(iri);
    if (!cls && iri !== OWL_THING) { return undefined; }
    const baseLabel = cls ? getLabel(cls, this.preferredLang) : (iri === OWL_THING ? 'owl:Thing' : iri);
    return new InferredClassTreeItem(iri, baseLabel, prefix, false);
  }

  getChildren(element?: InferredClassTreeItem): InferredClassTreeItem[] {
    if (!this.model?.isClassified) { return []; }

    // If we have an element, it's a neighborhood node, which has no children in this view
    if (element) { return []; }

    // Root level: if no focus, show owl:Thing root
    if (!this.focusIri) {
      const childCount = (this.sortedSubClasses.get(OWL_THING)?.length ?? 0);
      return [new InferredClassTreeItem(OWL_THING, 'owl:Thing', '', childCount > 0)];
    }

    // Neighborhood view: [parents] + [focus] + [children]
    const result: InferredClassTreeItem[] = [];

    // 1. Parents (Level 0)
    const parentIris = this.sortedSuperClasses.get(this.focusIri) ?? [];
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
    const childIris = this.sortedSubClasses.get(this.focusIri) ?? [];
    for (const iri of childIris) {
      const item = this.makeItem(iri, childPrefix);
      if (item) {
        item.collapsibleState = vscode.TreeItemCollapsibleState.None;
        result.push(item);
      }
    }

    return result;
  }
}
