import { useEffect, useRef } from "react";

/**
 * Dispara onLoadMore cuando el elemento sentinel entra en el viewport.
 * Útil para auto-cargar más contenido al hacer scroll sin clic en "Cargar más".
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  loading: boolean,
  hasMore: boolean
) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMoreRef.current();
      },
      { rootMargin: "200px", threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, hasMore]);

  return sentinelRef;
}
