import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';

type IndividualNode =
  | { kind: 'class'; iri: string; label: string; count: number }
  | { kind: 'individual'; iri: string; label: string };

export class IndividualTreeItem extends vscode.TreeItem {
  /** Top-level IRI so context-menu commands (copyIri, showEntityInfo, openGraph) can read it */
  public readonly iri: string;

  constructor(public readonly node: IndividualNode) {
    const isClass = node.kind === 'class';
    super(
      isClass ? `${node.label} (${node.count})` : node.label,
      isClass
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    this.iri = node.iri;
    this.id = `individual:${node.kind}:${node.iri}`;
    this.tooltip = vscode.workspace.getConfiguration('ontograph').get<boolean>('display.showIriOnHover', false) ? node.iri : '';
    this.contextValue = node.kind === 'individual' ? 'owlEntity' : 'owlClassGroup';
    this.iconPath = new vscode.ThemeIcon(isClass ? 'symbol-class' : 'symbol-object');
  }
}

export class IndividualBrowserProvider implements vscode.TreeDataProvider<IndividualTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<IndividualTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private model: OntologyModel | undefined;
  /** class IRI → individual IRIs (pre-sorted by individual label) */
  private byClass = new Map<string, string[]>();
  /** class IRIs ordered by class label */
  private sortedClassIris: string[] = [];
  /** individuals with no class assertion (pre-sorted by label) */
  private unclassified: string[] = [];
  private preferredLang = 'en';
  private readonly collator = new Intl.Collator(undefined, { sensitivity: 'base' });

  setModel(model: OntologyModel, preferredLang = 'en'): void {
    this.model = model;
    this.preferredLang = preferredLang;
    this.buildIndex();
    this._onDidChangeTreeData.fire();
  }

  private buildIndex(): void {
    this.byClass.clear();
    this.sortedClassIris = [];
    this.unclassified = [];
    if (!this.model) { return; }
    for (const ind of this.model.individuals.values()) {
      if (ind.classIris.length === 0) {
        this.unclassified.push(ind.iri);
      } else {
        for (const classIri of ind.classIris) {
          const members = this.byClass.get(classIri) ?? [];
          members.push(ind.iri);
          this.byClass.set(classIri, members);
        }
      }
    }
    this.sortedClassIris = [...this.byClass.keys()].sort((a, b) => {
      const ca = this.model!.classes.get(a);
      const cb = this.model!.classes.get(b);
      return this.collator.compare(
        ca ? getLabel(ca, this.preferredLang) : a,
        cb ? getLabel(cb, this.preferredLang) : b,
      );
    });
    for (const [, indIris] of this.byClass) {
      indIris.sort((a, b) => {
        const ia = this.model!.individuals.get(a);
        const ib = this.model!.individuals.get(b);
        return this.collator.compare(
          ia ? getLabel(ia, this.preferredLang) : a,
          ib ? getLabel(ib, this.preferredLang) : b,
        );
      });
    }
    this.unclassified.sort((a, b) => {
      const ia = this.model!.individuals.get(a);
      const ib = this.model!.individuals.get(b);
      return this.collator.compare(
        ia ? getLabel(ia, this.preferredLang) : a,
        ib ? getLabel(ib, this.preferredLang) : b,
      );
    });
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: IndividualTreeItem): vscode.TreeItem { return element; }

  getParent(element: IndividualTreeItem): IndividualTreeItem | undefined {
    if (element.node.kind === 'class') { return undefined; }
    const ind = this.model?.individuals.get(element.iri);
    if (!ind) { return undefined; }
    if (ind.classIris.length === 0) {
      return new IndividualTreeItem({ kind: 'class', iri: '_unclassified', label: '(no type)', count: this.unclassified.length });
    }
    const classIri = ind.classIris[0];
    const indIris = this.byClass.get(classIri) ?? [];
    const cls = this.model!.classes.get(classIri);
    const label = cls ? getLabel(cls, this.preferredLang) : classIri;
    return new IndividualTreeItem({ kind: 'class', iri: classIri, label, count: indIris.length });
  }

  makeItem(iri: string): IndividualTreeItem | undefined {
    if (!this.model) { return undefined; }
    const ind = this.model.individuals.get(iri);
    if (!ind) { return undefined; }
    return new IndividualTreeItem({ kind: 'individual', iri, label: getLabel(ind, this.preferredLang) });
  }

  getChildren(element?: IndividualTreeItem): IndividualTreeItem[] {
    if (!this.model) { return []; }

    if (!element) {
      const items = this.sortedClassIris.map(classIri => {
        const indIris = this.byClass.get(classIri)!;
        const cls = this.model!.classes.get(classIri);
        const label = cls ? getLabel(cls, this.preferredLang) : classIri;
        return new IndividualTreeItem({ kind: 'class', iri: classIri, label, count: indIris.length });
      });
      if (this.unclassified.length > 0) {
        items.push(new IndividualTreeItem({
          kind: 'class', iri: '_unclassified', label: '(no type)',
          count: this.unclassified.length,
        }));
      }
      return items;
    }

    if (element.node.kind === 'class') {
      const indIris = element.node.iri === '_unclassified'
        ? this.unclassified
        : (this.byClass.get(element.node.iri) ?? []);
      return indIris.map(iri => {
        const ind = this.model!.individuals.get(iri);
        const label = ind ? getLabel(ind, this.preferredLang) : iri;
        return new IndividualTreeItem({ kind: 'individual', iri, label });
      });
    }
    return [];
  }
}
