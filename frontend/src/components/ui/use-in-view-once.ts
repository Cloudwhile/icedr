import { useEffect, useState, type RefCallback } from "react";

type UseInViewOnceOptions = {
  rootMargin?: string;
};

export function useInViewOnce<T extends Element>({
  rootMargin = "200px",
}: UseInViewOnceOptions = {}): [RefCallback<T>, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [hasEnteredView, setHasEnteredView] = useState(false);

  useEffect(() => {
    if (!node || hasEnteredView) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setHasEnteredView(true);
        observer.disconnect();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasEnteredView, node, rootMargin]);

  return [setNode, hasEnteredView || typeof IntersectionObserver === "undefined"];
}
