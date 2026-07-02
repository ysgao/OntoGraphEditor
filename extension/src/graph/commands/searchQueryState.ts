let lastSearchQuery = '';

export function getSearchQuery(): string {
  return lastSearchQuery;
}

export function setSearchQuery(query: string): void {
  lastSearchQuery = query;
}

export function resetSearchQuery(): void {
  lastSearchQuery = '';
}
