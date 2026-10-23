import { AppImage } from "@/components/ui/app-image";

export function AuthBrand({ brandLogo, siteName }: { brandLogo: string; siteName: string }) {
  return (
    <div className="icedr-auth-brand">
      <AppImage src={brandLogo} alt="" />
      <strong>{siteName}</strong>
    </div>
  );
}
