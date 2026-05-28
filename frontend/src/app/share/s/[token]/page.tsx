import { ExternalShareRoute } from "@/views/drive/external-share-route";
import { getApiBaseUrl } from "@/lib/drive-api";
import type { RegisteredShare } from "@/features/share/registry";
import { notFound } from "next/navigation";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await fetchPublicShareForRoute(token);
  return <ExternalShareRoute initialShare={share} token={token} />;
}

export const dynamic = "force-dynamic";

async function fetchPublicShareForRoute(token: string) {
  const response = await fetch(`${getApiBaseUrl()}/shares/${encodeURIComponent(token)}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (response.status === 404 || response.status === 410) notFound();
  if (!response.ok) throw new Error("Unable to load share");

  const share = (await response.json()) as RegisteredShare;
  if (!hasRenderableShareRoot(share)) notFound();

  return share;
}

function hasRenderableShareRoot(share: RegisteredShare) {
  if (share.rootItemIds.length === 0) return false;
  const itemIds = new Set((share.items ?? []).map((item) => item.id));
  return share.rootItemIds.some((id) => itemIds.has(id));
}
