import * as vscode from 'vscode';
import type { OntologyModel } from '../model/OntologyModel';
import { getLabel } from '../model/OntologyModel';

const TOP_ANNOTATION_PROPERTY = 'http://www.w3.org/2002/07/owl#topAnnotationProperty';

export class AnnotationPropertyItem extends vscode.TreeItem {
  constructor(
    public readonly iri: string,
    label: string,
    hasChildren: boolean,
    icon: vscode.ThemeIcon,
  ) {
    super(label, hasChildren
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None);
    this.id = `annotprop:${iri}`;
    this.tooltip = vscode.workspace.getConfiguration('ontograph').get<boolean>('display.showIriOnHover', false) ? iri : '';
    this.contextValue = 'owlEntity';
    this.iconPath = icon;
  }
}

export class AnnotationPropertyProvider implements vscode.TreeDataProvider<AnnotationPropertyItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AnnotationPropertyItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private model: OntologyModel | undefined;
  private childrenOf = new Map<string, string[]>();
  private preferredLang = 'en';
  private readonly icon = new vscode.ThemeIcon('tag');
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
    for (const prop of this.model.annotationProperties.values()) {
      const parents = prop.superPropertyIris.length > 0
        ? prop.superPropertyIris
        : [TOP_ANNOTATION_PROPERTY];
      for (const parent of parents) {
        const siblings = this.childrenOf.get(parent) ?? [];
        siblings.push(prop.iri);
        this.childrenOf.set(parent, siblings);
      }
    }
    for (const [, children] of this.childrenOf) {
      children.sort((a, b) => {
        const pa = this.model!.annotationProperties.get(a);
        const pb = this.model!.annotationProperties.get(b);
        return this.collator.compare(
          pa ? getLabel(pa, this.preferredLang) : a,
          pb ? getLabel(pb, this.preferredLang) : b,
        );
      });
    }
  }

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(element: AnnotationPropertyItem): vscode.TreeItem { return element; }

  getParent(element: AnnotationPropertyItem): AnnotationPropertyItem | undefined {
    if (!this.model) { return undefined; }
    const prop = this.model.annotationProperties.get(element.iri);
    if (!prop || prop.superPropertyIris.length === 0) { return undefined; }
    const parentIri = prop.superPropertyIris[0];
    if (parentIri === TOP_ANNOTATION_PROPERTY) { return undefined; }
    const parent = this.model.annotationProperties.get(parentIri);
    if (!parent) { return undefined; }
    return new AnnotationPropertyItem(
      parentIri,
      getLabel(parent, this.preferredLang),
      (this.childrenOf.get(parentIri)?.length ?? 0) > 0,
      this.icon,
    );
  }

  makeItem(iri: string): AnnotationPropertyItem | undefined {
    if (!this.model) { return undefined; }
    const prop = this.model.annotationProperties.get(iri);
    if (!prop) { return undefined; }
    return new AnnotationPropertyItem(
      iri,
      getLabel(prop, this.preferredLang),
      (this.childrenOf.get(iri)?.length ?? 0) > 0,
      this.icon,
    );
  }

  getChildren(element?: AnnotationPropertyItem): AnnotationPropertyItem[] {
    if (!this.model) { return []; }
    const parentIri = element?.iri ?? TOP_ANNOTATION_PROPERTY;
    const childIris = this.childrenOf.get(parentIri) ?? [];
    return childIris.map(iri => {
      const prop = this.model!.annotationProperties.get(iri);
      const label = prop ? getLabel(prop, this.preferredLang) : iri;
      const hasChildren = (this.childrenOf.get(iri)?.length ?? 0) > 0;
      return new AnnotationPropertyItem(iri, label, hasChildren, this.icon);
    });
  }
}
