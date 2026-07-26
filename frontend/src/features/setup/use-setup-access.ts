"use client";

import { useCallback, useEffect, useState } from "react";
import {
  clearStoredSetupToken,
  DriveApiError,
  fetchSetupStatus,
  getStoredSetupToken,
  isAuthorizedSetupStatus,
  isSetupAccessInvalidatingError,
  setStoredSetupToken,
  type SetupAuthorizedStatus,
  type SetupStatus,
} from "@/lib/drive-api";

export type AuthorizedSetupStatus = SetupAuthorizedStatus;

export type SetupAccessPhase =
  | "authorized"
  | "loading"
  | "locked"
  | "unavailable";

export type SetupAccessNotice =
  | "expired"
  | "invalid"
  | "status-failed"
  | null;

export function useSetupAccess({
  onAccessCleared,
  onAuthorized,
  onCompleted,
}: {
  onAccessCleared: () => void;
  onAuthorized: (status: AuthorizedSetupStatus) => void;
  onCompleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState("");
  const [notice, setNotice] = useState<SetupAccessNotice>(null);
  const [phase, setPhase] = useState<SetupAccessPhase>("loading");
  const [setupStatus, setSetupStatus] =
    useState<AuthorizedSetupStatus | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const clearAccessState = useCallback(
    (
      nextNotice: SetupAccessNotice = null,
      nextPhase: Extract<SetupAccessPhase, "locked" | "unavailable"> = "locked",
    ) => {
      clearStoredSetupToken();
      setCredential("");
      setNotice(nextNotice);
      setPhase(nextPhase);
      setSetupStatus(null);
      setToken(null);
      onAccessCleared();
    },
    [onAccessCleared],
  );

  const applyStatus = useCallback(
    (status: SetupStatus, candidate: string | null) => {
      if (!status.needsSetup) {
        clearStoredSetupToken();
        setCredential("");
        setNotice(null);
        setSetupStatus(null);
        setToken(null);
        onAccessCleared();
        onCompleted();
        return;
      }

      if (!isAuthorizedSetupStatus(status) || !candidate) {
        if (candidate) {
          onAccessCleared();
        }
        setCredential("");
        setNotice(candidate ? "invalid" : null);
        setPhase(status.setupAccess.configured ? "locked" : "unavailable");
        setSetupStatus(null);
        setToken(null);
        return;
      }

      setStoredSetupToken(candidate);
      setCredential("");
      setNotice(null);
      setPhase("authorized");
      setSetupStatus(status);
      setToken(candidate);
      onAuthorized(status);
    },
    [onAccessCleared, onAuthorized, onCompleted],
  );

  const loadStatus = useCallback(
    async (candidate: string | null, initial = false) => {
      if (initial) setPhase("loading");
      setBusy(true);
      setNotice(null);
      try {
        const status = await fetchSetupStatus(candidate ?? undefined);
        applyStatus(status, candidate);
      } catch (error) {
        if (candidate && isSetupAccessInvalidatingError(error)) {
          const unavailable = isSetupBootstrapUnavailableError(error);
          clearAccessState(
            unavailable ? null : "expired",
            unavailable ? "unavailable" : "locked",
          );
        } else {
          setNotice("status-failed");
          setPhase("unavailable");
        }
      } finally {
        setBusy(false);
      }
    },
    [applyStatus, clearAccessState],
  );

  useEffect(() => {
    let cancelled = false;
    const candidate = getStoredSetupToken();
    void Promise.resolve().then(() => {
      if (!cancelled) return loadStatus(candidate, true);
    });
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  const authorize = useCallback(async () => {
    const candidate = credential.trim();
    if (!candidate || busy) return;
    await loadStatus(candidate);
  }, [busy, credential, loadStatus]);

  const retry = useCallback(async () => {
    if (busy) return;
    await loadStatus(credential.trim() || getStoredSetupToken(), true);
  }, [busy, credential, loadStatus]);

  const handleOperationError = useCallback(
    (error: unknown) => {
      if (!isSetupAccessInvalidatingError(error)) return false;
      const unavailable = isSetupBootstrapUnavailableError(error);
      clearAccessState(
        unavailable ? null : "expired",
        unavailable ? "unavailable" : "locked",
      );
      return true;
    },
    [clearAccessState],
  );

  const completeAccess = useCallback(() => {
    clearStoredSetupToken();
    setCredential("");
    setNotice(null);
    setSetupStatus(null);
    setToken(null);
    onAccessCleared();
  }, [onAccessCleared]);

  return {
    authorize,
    busy,
    clearAccess: clearAccessState,
    completeAccess,
    credential,
    handleOperationError,
    notice,
    phase,
    retry,
    setCredential,
    setupStatus,
    token,
  };
}

function isSetupBootstrapUnavailableError(error: unknown) {
  return (
    error instanceof DriveApiError &&
    error.code === "SETUP_BOOTSTRAP_UNAVAILABLE"
  );
}
