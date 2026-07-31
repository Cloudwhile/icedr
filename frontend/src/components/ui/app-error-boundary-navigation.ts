type BrowserReloadLocation = Pick<Location, "reload">;
type BrowserNavigationLocation = Pick<Location, "assign">;

export function hardReloadPage(
  location: BrowserReloadLocation = window.location,
) {
  location.reload();
}

export function hardNavigateHome(
  location: BrowserNavigationLocation = window.location,
) {
  location.assign("/");
}
