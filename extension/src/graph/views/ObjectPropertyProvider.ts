import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';

const TOP_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#topObjectProperty';

export class PropertyTreeItem extends vscode.TreeItem {
  constructor(
    public readonly iri: string,
    label: string,
    hasChildren: boolean,
    icon: vscode.ThemeIcon,
    contextValue = 'owlEntity',
  ) {
    super(label, hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
    this.id = `objectprop:${iri}`;
    this.tooltip = vscode.workspace.getConfiguration('ontograph').get<boolean>('display.showIriOnHover', false) ? iri : '';
    this.contextValue = contextValue;
    this.iconPath = icon;
  }
}

export class ObjectPropertyProvider implements vscode.TreeDataProvider<PropertyTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PropertyTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private model: OntologyModel | undefined;
  private childrenOf = new Map<string, string[]>();
  private preferredLang = 'en';
  private readonly icon = new vscode.ThemeIcon('symbol-interface');
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
    for (const prop of this.model.objectProperties.values()) {
      const parents = prop.superPropertyIris.length > 0
        ? prop.superPropertyIris
        : [TOP_OBJECT_PROPERTY];
      for (const parent of parents) {
        const siblings = this.childrenOf.get(parent) ?? [];
        siblings.push(prop.iri);
        this.childrenOf.set(parent, siblings);
      }
    }
    for (const [, children] of this.childrenOf) {
      children.sort((a, b) => {
        const pa = this.model!.objectProperties.get(a);
        const pb = this.model!.objectProperties.get(b);
        return this.collator.compare(
          pa ? getLabel(pa, this.preferredLang) : a,
          pb ? getLabel(pb, this.preferredLang) : b,
        );
      });
    }
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: PropertyTreeItem): vscode.TreeItem { return element; }

  getParent(element: PropertyTreeItem): PropertyTreeItem | undefined {
    if (!this.model) { return undefined; }
    const prop = this.model.objectProperties.get(element.iri);
    if (!prop || prop.superPropertyIris.length === 0) { return undefined; }
    const parentIri = prop.superPropertyIris[0];
    if (parentIri === TOP_OBJECT_PROPERTY) { return undefined; }
    const parent = this.model.objectProperties.get(parentIri);
    if (!parent) { return undefined; }
    return new PropertyTreeItem(
      parentIri,
      getLabel(parent, this.preferredLang),
      (this.childrenOf.get(parentIri)?.length ?? 0) > 0,
      this.icon,
    );
  }

  makeItem(iri: string): PropertyTreeItem | undefined {
    if (!this.model) { return undefined; }
    const prop = this.model.objectProperties.get(iri);
    if (!prop) { return undefined; }
    return new PropertyTreeItem(
      iri,
      getLabel(prop, this.preferredLang),
      (this.childrenOf.get(iri)?.length ?? 0) > 0,
      this.icon,
    );
  }

  getChildren(element?: PropertyTreeItem): PropertyTreeItem[] {
    if (!this.model) { return []; }
    const parentIri = element?.iri ?? TOP_OBJECT_PROPERTY;
    const childIris = this.childrenOf.get(parentIri) ?? [];
    return childIris.map(iri => {
      const prop = this.model!.objectProperties.get(iri);
      const label = prop ? getLabel(prop, this.preferredLang) : iri;
      const hasChildren = (this.childrenOf.get(iri)?.length ?? 0) > 0;
      return new PropertyTreeItem(iri, label, hasChildren, this.icon);
    });
  }
}
