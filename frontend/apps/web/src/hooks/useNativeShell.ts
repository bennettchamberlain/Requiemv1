import { useEffect } from 'react';

import { addBackButtonListener, exitApp, hideSplashScreen, isNativePlatform } from '@ci/common';
import { useNavigate } from 'react-router-dom';

/**
 * Wires the React app into the native Capacitor shell. All effects are guarded by
 * `isNativePlatform()`, so this is inert on web.
 *
 * - Dismisses the native splash screen once the app has mounted.
 * - Handles the Android hardware back button: navigate back through history, or quit
 *   the app at the root (without this, the back button closes the app immediately —
 *   the default Capacitor behavior — which is jarring mid-navigation).
 *
 * Must be rendered inside the Router so it can navigate.
 */
export function useNativeShell(): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativePlatform()) {
      return;
    }

    void hideSplashScreen();

    let unsubscribe = () => {};

    void addBackButtonListener((canGoBack) => {
      if (canGoBack) {
        navigate(-1);
      } else {
        void exitApp();
      }
    }).then((fn) => {
      unsubscribe = fn;
    });

    return () => {
      unsubscribe();
    };
  }, [navigate]);
}
