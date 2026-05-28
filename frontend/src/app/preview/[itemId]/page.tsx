import { FilePreviewRoute } from "@/views/drive/file-preview-route";

export default async function PreviewPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return <FilePreviewRoute itemId={itemId} />;
}
