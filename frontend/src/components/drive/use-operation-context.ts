import { useCallback, useEffect, useMemo, useRef } from "react";

export function useOperationContext(key: string) {
  const context = useMemo(() => ({ key }), [key]);
  const activeContext = useRef<object | null>(null);
  useEffect(() => {
    activeContext.current = context;
    return () => { activeContext.current = null; };
  }, [context]);
  return useCallback(() => activeContext.current === context, [context]);
}
