import { useCallback, useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

export function usePwaStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const {
    needRefresh: [isUpdateAvailable, setIsUpdateAvailable],
    offlineReady: [isOfflineReady, setIsOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    const updateConnectivity = () => setIsOnline(navigator.onLine);

    window.addEventListener("online", updateConnectivity);
    window.addEventListener("offline", updateConnectivity);

    return () => {
      window.removeEventListener("online", updateConnectivity);
      window.removeEventListener("offline", updateConnectivity);
    };
  }, []);

  const dismissOfflineReady = useCallback(() => {
    setIsOfflineReady(false);
  }, [setIsOfflineReady]);

  const dismissUpdate = useCallback(() => {
    setIsUpdateAvailable(false);
  }, [setIsUpdateAvailable]);

  const applyUpdate = useCallback(() => {
    void updateServiceWorker();
  }, [updateServiceWorker]);

  return {
    applyUpdate,
    dismissOfflineReady,
    dismissUpdate,
    isOfflineReady,
    isOnline,
    isUpdateAvailable,
  };
}
