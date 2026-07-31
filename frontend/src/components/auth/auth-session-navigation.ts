export function createLoginRedirect(source: string) {
  const normalizedSource =
    source.startsWith("/") && !source.startsWith("//") ? source : "/";
  return `/login?next=${encodeURIComponent(normalizedSource)}`;
}
