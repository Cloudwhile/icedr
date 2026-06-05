import { AuthRoute } from "@/views/drive/auth-client";
import { AdminApp } from "@/views/drive/admin-app";
import { DriveApp } from "@/views/drive/drive-app";
import { ExternalShareRoute } from "@/views/drive/external-share-route";
import { LegalPageRoute } from "@/views/drive/legal-page";
import { NotFoundRoute } from "@/views/drive/not-found-route";
import { OAuthCallbackRoute } from "@/views/drive/oauth-callback-client";
import { SetupRoute } from "@/views/drive/setup-client";
import { usePathname, useRouter } from "@/compat/navigation";
import { useEffect } from "react";

export function App() {
  const pathname = normalizePathname(usePathname());
  const previewItemId = matchDynamicSegment(pathname, /^\/preview\/([^/]+)$/);
  const shareToken = matchDynamicSegment(pathname, /^\/share\/s\/([^/]+)$/);

  if (pathname === "/" || pathname === "/dashboard" || pathname === "/files") return <DriveApp />;
  if (pathname === "/settings") return <DriveApp initialActiveNav="settings" />;
  if (pathname === "/login") return <AuthRoute mode="login" />;
  if (pathname === "/register") return <AuthRoute mode="register" />;
  if (pathname === "/forgot-password") return <AuthRoute mode="forgot" />;
  if (pathname === "/reset-password") return <AuthRoute mode="reset" />;
  if (pathname === "/setup") return <SetupRoute />;
  if (pathname === "/callback") return <OAuthCallbackRoute />;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return <AdminApp />;
  if (pathname === "/settings/external-share") {
    return <RedirectToAdmin target="/admin/external-share" />;
  }
  if (pathname === "/privacy") return <LegalPageRoute documentKey="privacy" />;
  if (pathname === "/terms") return <LegalPageRoute documentKey="terms" />;
  if (previewItemId) return <DriveApp initialPreviewItemId={previewItemId} />;
  if (shareToken) return <ExternalShareRoute token={shareToken} />;

  return <NotFoundRoute />;
}

function RedirectToAdmin({ target = "/admin" }: { target?: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(target);
  }, [router, target]);
  return null;
}

function normalizePathname(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

function matchDynamicSegment(pathname: string, pattern: RegExp) {
  const match = pathname.match(pattern);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
