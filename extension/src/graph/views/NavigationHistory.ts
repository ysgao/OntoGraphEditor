export class NavigationHistory {
  private readonly MAX_DEPTH = 50;
  private backStack: string[] = [];
  private forwardStack: string[] = [];

  push(iri: string): void {
    if (!iri) { return; }
    if (this.backStack.at(-1) === iri) { return; }
    this.backStack.push(iri);
    if (this.backStack.length > this.MAX_DEPTH) { this.backStack.shift(); }
    this.forwardStack = [];
  }

  back(): string | undefined {
    if (this.backStack.length <= 1) { return undefined; }
    const current = this.backStack.pop()!;
    this.forwardStack.push(current);
    return this.backStack.at(-1);
  }

  forward(): string | undefined {
    const next = this.forwardStack.pop();
    if (next !== undefined) { this.backStack.push(next); }
    return next;
  }

  clear(): void {
    this.backStack = [];
    this.forwardStack = [];
  }

  get canGoBack(): boolean {
    return this.backStack.length > 1;
  }

  get canGoForward(): boolean {
    return this.forwardStack.length > 0;
  }
}
