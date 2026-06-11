import { AuthRoute } from "@/views/drive/auth-client";
import { AdminApp } from "@/views/drive/admin-app";
import { DriveApp } from "@/views/drive/drive-app";
import { ExternalShareRoute } from "@/views/drive/external-share-route";
import { LegalPageRoute } from "@/views/drive/legal-page";
import { NotFoundRoute } from "@/views/drive/not-found-route";
import { OAuthCallbackRoute } from "@/views/drive/oauth-callback-client";
import { SetupRoute } from "@/views/drive/setup-client";
import { usePathname, useRouter } from "@/compat/navigation";
import type { DriveUserNav } from "@/features/file/model";
import { useLocale, useTranslations } from "@/i18n/react";
import { useEffect, useMemo } from "react";

type DocumentTitleParts = {
  title: string;
  subtitle?: string;
};

const driveRouteNavs: Record<string, DriveUserNav> = {
  "/": "drive",
  "/links": "links",
  "/recent": "recent",
  "/settings": "settings",
  "/shared": "shared",
  "/starred": "starred",
  "/transfers": "transfers",
  "/trash": "trash",
};

export function App() {
  const pathname = normalizePathname(usePathname());
  const locale = useLocale();
  const t = useTranslations();
  const previewItemId = matchDynamicSegment(pathname, /^\/preview\/([^/]+)$/);
  const shareToken = matchDynamicSegment(pathname, /^\/share\/s\/([^/]+)$/);
  const documentTitle = useMemo(
    () => getDocumentTitleParts(pathname, locale, t),
    [locale, pathname, t],
  );
  useDocumentTitle(documentTitle);

  const driveNav = driveRouteNavs[pathname];
  if (driveNav) return <DriveApp initialActiveNav={driveNav} />;
  if (pathname === "/dashboard" || pathname === "/files") return <RedirectTo target="/" />;
  if (pathname === "/login") return <AuthRoute mode="login" />;
  if (pathname === "/register") return <AuthRoute mode="register" />;
  if (pathname === "/forgot-password") return <AuthRoute mode="forgot" />;
  if (pathname === "/reset-password") return <AuthRoute mode="reset" />;
  if (pathname === "/setup") return <SetupRoute />;
  if (pathname === "/callback") return <OAuthCallbackRoute />;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return <AdminApp />;
  if (pathname === "/settings/external-share") {
    return <RedirectTo target="/admin/external-share" />;
  }
  if (pathname === "/privacy") return <LegalPageRoute documentKey="privacy" />;
  if (pathname === "/terms") return <LegalPageRoute documentKey="terms" />;
  if (previewItemId) return <DriveApp initialPreviewItemId={previewItemId} />;
  if (shareToken) return <ExternalShareRoute token={shareToken} />;

  return <NotFoundRoute />;
}

function RedirectTo({ target = "/admin" }: { target?: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(target);
  }, [router, target]);
  return null;
}

function useDocumentTitle({ title, subtitle }: DocumentTitleParts) {
  useEffect(() => {
    const parts = [title, subtitle].filter((part): part is string => Boolean(part?.trim()));
    document.title = parts.length ? `${parts.join(" · ")} · ICEDR` : "ICEDR";
  }, [subtitle, title]);
}

function getDocumentTitleParts(
  pathname: string,
  locale: string,
  t: ReturnType<typeof useTranslations>,
): DocumentTitleParts {
  const driveTitle = getDriveDocumentTitleParts(pathname, t);
  if (driveTitle) return driveTitle;
  const authTitle = getAuthDocumentTitleParts(pathname, t);
  if (authTitle) return authTitle;

  if (pathname === "/setup") return { title: t("setup.title"), subtitle: t("app.workspace") };
  if (pathname === "/callback") return { title: t("auth.oauthCallbackTitle"), subtitle: t("app.workspace") };
  if (pathname === "/privacy") return getLegalDocumentTitleParts("privacy", locale, t);
  if (pathname === "/terms") return getLegalDocumentTitleParts("terms", locale, t);
  if (pathname.startsWith("/admin")) return getAdminDocumentTitleParts(pathname, t);
  if (pathname.startsWith("/preview/")) return { title: t("preview.title"), subtitle: t("nav.drive") };
  if (pathname.startsWith("/share/s/")) return { title: t("share.title"), subtitle: t("share.secureShare") };

  return { title: "ICEDR", subtitle: t("notFound.title") };
}

function getDriveDocumentTitleParts(
  pathname: string,
  t: ReturnType<typeof useTranslations>,
): DocumentTitleParts | null {
  const nav = driveRouteNavs[pathname];
  if (!nav) return null;
  if (nav === "links") return { title: t("links.title"), subtitle: t("links.subtitle") };
  if (nav === "transfers") return { title: t("transfers.title"), subtitle: t("transfers.subtitle") };
  if (nav === "settings") return { title: t("settings.profile"), subtitle: t("settings.profileSubtitle") };
  return { title: t(`nav.${nav}`), subtitle: t("app.workspace") };
}

function getAuthDocumentTitleParts(
  pathname: string,
  t: ReturnType<typeof useTranslations>,
): DocumentTitleParts | null {
  if (pathname === "/login") return { title: t("auth.loginTitle"), subtitle: t("auth.loginDescription") };
  if (pathname === "/register") return { title: t("auth.registerTitle"), subtitle: t("auth.registerDescription") };
  if (pathname === "/forgot-password") return { title: t("auth.forgotTitle"), subtitle: t("auth.forgotDescription") };
  if (pathname === "/reset-password") return { title: t("auth.resetTitle"), subtitle: t("auth.resetDescription") };
  return null;
}

function getAdminDocumentTitleParts(
  pathname: string,
  t: ReturnType<typeof useTranslations>,
): DocumentTitleParts {
  if (pathname === "/admin/audit") return { title: t("audit.title"), subtitle: t("audit.subtitle") };
  if (pathname === "/admin/external-share") {
    return { title: t("admin.externalLinkPolicy"), subtitle: t("admin.externalLinkPolicySubtitle") };
  }
  if (pathname === "/admin/system/storage") {
    return { title: t("settings.storagePolicy"), subtitle: t("settings.storagePolicySubtitle") };
  }
  if (pathname === "/admin/system/lifecycle") {
    return { title: t("settings.lifecyclePolicy"), subtitle: t("settings.lifecyclePolicySubtitle") };
  }
  if (pathname === "/admin/system" || pathname === "/admin/system/platform") {
    return { title: t("settings.systemPlatform"), subtitle: t("settings.systemPlatformSubtitle") };
  }
  return { title: t("admin.overview"), subtitle: t("admin.overviewSubtitle") };
}

function getLegalDocumentTitleParts(
  documentKey: "privacy" | "terms",
  locale: string,
  t: ReturnType<typeof useTranslations>,
): DocumentTitleParts {
  const legalLocale = locale === "zh" || locale.toLocaleLowerCase().startsWith("zh") ? "zh" : "en";
  return {
    subtitle: t(`legal.documents.${documentKey}.${legalLocale}.subtitle`),
    title: t(`legal.documents.${documentKey}.${legalLocale}.title`),
  };
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
