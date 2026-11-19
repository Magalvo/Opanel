/** One page of a cursor-paged list (canonical doc 0004 section 5). */
export interface Page<T> {
  items: readonly T[];
  nextCursor: string | null;
}

/**
 * `current` followed by `incoming`, each id once (WS-080). The server's order wins: an item
 * already shown that comes back with a later page moves to where that page puts it.
 */
export function mergePage<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): readonly T[] {
  if (incoming.length === 0) return current;
  const arriving = new Set(incoming.map((item) => item.id));
  return [...current.filter((item) => !arriving.has(item.id)), ...incoming];
}
