import { useEffect, useRef, useState } from "react";

const photoCache = new Map<string, string | null>();

/**
 * Lazy-loads a single thumbnail photo for a Google Place ID.
 * Only fetches when the element is visible in the viewport (IntersectionObserver).
 */
export function usePlacePhoto(placeId: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(
    placeId ? photoCache.get(placeId) ?? null : null
  );
  const [loaded, setLoaded] = useState(placeId ? photoCache.has(placeId) : true);
  const ref = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!placeId || photoCache.has(placeId)) {
      setUrl(photoCache.get(placeId!) ?? null);
      setLoaded(true);
      return;
    }

    const el = ref.current;
    if (!el) return;

    fetchedRef.current = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || fetchedRef.current) return;
        fetchedRef.current = true;
        observer.disconnect();

        fetch(`/api/places/photo?id=${encodeURIComponent(placeId)}`)
          .then((r) => (r.ok ? r.json() : { url: null }))
          .then((d) => {
            photoCache.set(placeId, d.url);
            setUrl(d.url);
            setLoaded(true);
          })
          .catch(() => {
            photoCache.set(placeId, null);
            setLoaded(true);
          });
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [placeId]);

  return { url, loaded, ref };
}
