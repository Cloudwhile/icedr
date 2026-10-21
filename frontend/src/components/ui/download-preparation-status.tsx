import { useSyncExternalStore } from "react";
import { LocalIcon } from "./app-icon";
import {
  getDownloadPreparationsSnapshot,
  subscribeDownloadPreparations,
} from "./download-preparation-store";

export function DownloadPreparationStatus() {
  const preparations = useSyncExternalStore(
    subscribeDownloadPreparations,
    getDownloadPreparationsSnapshot,
    getDownloadPreparationsSnapshot,
  );

  return preparations.map(({ key, label }) => (
    <div className="icedr-app-toast icedr-download-preparation" data-variant="accent" key={key} role="status">
      <div className="icedr-app-toast-content">
        <span className="icedr-app-toast-indicator" aria-hidden="true"><LocalIcon name="download" size={15} /></span>
        <span className="icedr-app-toast-copy">
          <span className="icedr-app-toast-title">{label}</span>
          <progress aria-label={label} className="icedr-download-preparation-progress" />
        </span>
      </div>
    </div>
  ));
}
