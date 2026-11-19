import { useCallback, useRef, useState } from "react";

import { mergePage, type Page } from "@/lib/paged-list";

export interface PagedList<T extends { id: string }> {
  items: readonly T[];
  nextCursor: string | null;
  loadingMore: boolean;
  /** Replaces the list with a first page. A page still loading for the old list is dropped. */
  show: (page: Page<T>) => void;
  /** The filter or view changed: a page still loading for the old one is dropped. */
  invalidate: () => void;
  /**
   * Appends the next page, each id once. Asks for nothing when there is no next page or one
   * is loading. A failure is rethrown unless the list was replaced meanwhile.
   */
  loadMore: (read: (cursor: string) => Promise<Page<T>>) => Promise<void>;
  /** Whether every page is shown, read from the current state, not a render's. */
  isFullyLoaded: () => boolean;
  /** Appends an item unless its id is shown. */
  add: (item: T) => void;
  /** Changes the shown items, for example to replace or remove one. */
  update: (change: (items: readonly T[]) => readonly T[]) => void;
}

/**
 * The paging state of a "Load more" list (WS-080): no row twice, no stale page, no second
 * load while one runs. Phases, messages and rendering stay in each page.
 */
export function usePagedList<T extends { id: string }>(initial?: Page<T>): PagedList<T> {
  const [items, setItems] = useState<readonly T[]>(initial?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Mirrors of the state, written only in handlers, for reads that must not use a render's
  // closure: two clicks in one frame, or an invitation submitted a render ago.
  const cursorRef = useRef<string | null>(initial?.nextCursor ?? null);
  const shownRef = useRef(initial !== undefined);
  const loadingRef = useRef(false);
  const generationRef = useRef(0);

  const setCursor = useCallback((cursor: string | null) => {
    cursorRef.current = cursor;
    setNextCursor(cursor);
  }, []);

  const startGeneration = useCallback(() => {
    generationRef.current += 1;
    loadingRef.current = false;
    setLoadingMore(false);
  }, []);

  const show = useCallback(
    (page: Page<T>) => {
      startGeneration();
      shownRef.current = true;
      setItems(page.items);
      setCursor(page.nextCursor);
    },
    [setCursor, startGeneration],
  );

  const loadMore = useCallback(
    async (read: (cursor: string) => Promise<Page<T>>) => {
      const cursor = cursorRef.current;
      if (cursor === null || loadingRef.current) return;
      const generation = generationRef.current;
      loadingRef.current = true;
      setLoadingMore(true);
      try {
        const page = await read(cursor);
        if (generation !== generationRef.current) return;
        setItems((current) => mergePage(current, page.items));
        setCursor(page.nextCursor);
      } catch (error) {
        if (generation === generationRef.current) throw error;
      } finally {
        if (generation === generationRef.current) {
          loadingRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [setCursor],
  );

  const isFullyLoaded = useCallback(() => shownRef.current && cursorRef.current === null, []);

  const add = useCallback((item: T) => {
    setItems((current) =>
      current.some((shown) => shown.id === item.id) ? current : [...current, item],
    );
  }, []);

  const update = useCallback((change: (items: readonly T[]) => readonly T[]) => {
    setItems((current) => change(current));
  }, []);

  return {
    items,
    nextCursor,
    loadingMore,
    show,
    invalidate: startGeneration,
    loadMore,
    isFullyLoaded,
    add,
    update,
  };
}
