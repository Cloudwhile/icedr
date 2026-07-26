const localNavigationOrigin = "https://icedr.local";

export function resolveAuthNextTarget(next: string) {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  ) {
    return "/";
  }

  try {
    const target = new URL(next, localNavigationOrigin);
    if (target.origin !== localNavigationOrigin) return "/";
    if (isAuthRoutePath(target.pathname)) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

function isAuthRoutePath(pathname: string) {
  const normalized = (pathname || "/").replace(/\/+$/, "") || "/";
  return (
    normalized === "/login" ||
    normalized === "/register" ||
    normalized === "/forgot-password" ||
    normalized === "/reset-password"
  );
}
