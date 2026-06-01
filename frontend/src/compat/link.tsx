import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { useRouter } from "@/compat/navigation";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | URL;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, onClick, replace = false, target, ...props },
  ref,
) {
  const router = useRouter();
  const resolvedHref = typeof href === "string" ? href : href.toString();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (shouldLetBrowserHandleClick(event, resolvedHref, target)) return;

    event.preventDefault();
    if (replace) router.replace(resolvedHref);
    else router.push(resolvedHref);
  };

  return <a ref={ref} href={resolvedHref} onClick={handleClick} target={target} {...props} />;
});

export default Link;

function shouldLetBrowserHandleClick(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
  target: AnchorHTMLAttributes<HTMLAnchorElement>["target"],
) {
  if (event.defaultPrevented) return true;
  if (event.button !== 0) return true;
  if (target && target !== "_self") return true;
  if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return true;
  return isExternalHref(href);
}

function isExternalHref(href: string) {
  if (href.startsWith("#")) return false;
  try {
    const url = new URL(href, window.location.href);
    return url.origin !== window.location.origin;
  } catch {
    return false;
  }
}
