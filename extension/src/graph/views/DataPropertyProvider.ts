import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';

const TOP_DATA_PROPERTY = 'http://www.w3.org/2002/07/owl#topDataProperty';

export class DataPropertyItem extends vscode.TreeItem {
  constructor(
    public readonly iri: string,
    label: string,
    hasChildren: boolean,
    icon: vscode.ThemeIcon,
  ) {
    super(label, hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
    this.id = `dataprop:${iri}`;
    this.tooltip = vscode.workspace.getConfiguration('ontograph').get<boolean>('display.showIriOnHover', false) ? iri : '';
    this.contextValue = 'owlEntity';
    this.iconPath = icon;
  }
}

export class DataPropertyProvider implements vscode.TreeDataProvider<DataPropertyItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DataPropertyItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private model: OntologyModel | undefined;
  private childrenOf = new Map<string, string[]>();
  private preferredLang = 'en';
  private readonly icon = new vscode.ThemeIcon('symbol-field');
  private readonly collator = new Intl.Collator(undefined, { sensitivity: 'base' });

  setModel(model: OntologyModel, preferredLang = 'en'): void {
    this.model = model;
    this.preferredLang = preferredLang;
    this.buildIndex();
    this._onDidChangeTreeData.fire();
  }

  private buildIndex(): void {
    this.childrenOf.clear();
    if (!this.model) { return; }
    for (const prop of this.model.dataProperties.values()) {
      const parents = prop.superPropertyIris.length > 0
        ? prop.superPropertyIris
        : [TOP_DATA_PROPERTY];
      for (const parent of parents) {
        const siblings = this.childrenOf.get(parent) ?? [];
        siblings.push(prop.iri);
        this.childrenOf.set(parent, siblings);
      }
    }
    for (const [, children] of this.childrenOf) {
      children.sort((a, b) => {
        const pa = this.model!.dataProperties.get(a);
        const pb = this.model!.dataProperties.get(b);
        return this.collator.compare(
          pa ? getLabel(pa, this.preferredLang) : a,
          pb ? getLabel(pb, this.preferredLang) : b,
        );
      });
    }
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: DataPropertyItem): vscode.TreeItem { return element; }

  getParent(element: DataPropertyItem): DataPropertyItem | undefined {
    if (!this.model) { return undefined; }
    const prop = this.model.dataProperties.get(element.iri);
    if (!prop || prop.superPropertyIris.length === 0) { return undefined; }
    const parentIri = prop.superPropertyIris[0];
    if (parentIri === TOP_DATA_PROPERTY) { return undefined; }
    const parent = this.model.dataProperties.get(parentIri);
    if (!parent) { return undefined; }
    return new DataPropertyItem(
      parentIri,
      getLabel(parent, this.preferredLang),
      (this.childrenOf.get(parentIri)?.length ?? 0) > 0,
      this.icon,
    );
  }

  makeItem(iri: string): DataPropertyItem | undefined {
    if (!this.model) { return undefined; }
    const prop = this.model.dataProperties.get(iri);
    if (!prop) { return undefined; }
    return new DataPropertyItem(
      iri,
      getLabel(prop, this.preferredLang),
      (this.childrenOf.get(iri)?.length ?? 0) > 0,
      this.icon,
    );
  }

  getChildren(element?: DataPropertyItem): DataPropertyItem[] {
    if (!this.model) { return []; }
    const parentIri = element?.iri ?? TOP_DATA_PROPERTY;
    const childIris = this.childrenOf.get(parentIri) ?? [];
    return childIris.map(iri => {
      const prop = this.model!.dataProperties.get(iri);
      const label = prop ? getLabel(prop, this.preferredLang) : iri;
      const hasChildren = (this.childrenOf.get(iri)?.length ?? 0) > 0;
      return new DataPropertyItem(iri, label, hasChildren, this.icon);
    });
  }
}
