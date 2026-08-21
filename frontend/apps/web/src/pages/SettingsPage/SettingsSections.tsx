import { lazy, Suspense, type ReactNode } from 'react';

import { LoadingPage } from '@ci/common';
import { Navigate } from 'react-router-dom';

const AppearanceSection = lazy(() =>
  import('./sections/AppearanceSection').then((m) => ({ default: m.AppearanceSection })),
);
const PreferencesSection = lazy(() =>
  import('./sections/PreferencesSection').then((m) => ({ default: m.PreferencesSection })),
);
const AutonomySection = lazy(() =>
  import('./sections/AutonomySection').then((m) => ({ default: m.AutonomySection })),
);
const AboutYouSection = lazy(() =>
  import('./sections/AboutYouSection').then((m) => ({ default: m.AboutYouSection })),
);
const ModelSection = lazy(() => import('./sections/ModelSection').then((m) => ({ default: m.ModelSection })));
const LocationSection = lazy(() =>
  import('./sections/LocationSection').then((m) => ({ default: m.LocationSection })),
);
const SafariExtensionSection = lazy(() =>
  import('./sections/SafariExtensionSection').then((m) => ({ default: m.SafariExtensionSection })),
);
const ApiKeysSection = lazy(() =>
  import('./sections/ApiKeysSection').then((m) => ({ default: m.ApiKeysSection })),
);
const OAuthSection = lazy(() => import('./sections/OAuthSection').then((m) => ({ default: m.OAuthSection })));
const AccountSection = lazy(() =>
  import('./sections/AccountSection').then((m) => ({ default: m.AccountSection })),
);
const DataPortabilitySection = lazy(() =>
  import('./sections/DataPortabilitySection').then((m) => ({ default: m.DataPortabilitySection })),
);

function sectionElement(section: string): ReactNode {
  switch (section) {
    case 'appearance':
      return <AppearanceSection />;
    case 'preferences':
      return <PreferencesSection />;
    case 'autonomy':
      return <AutonomySection />;
    case 'about-you':
      return <AboutYouSection />;
    case 'model':
      return <ModelSection />;
    case 'location':
      return <LocationSection />;
    case 'safari':
      return <SafariExtensionSection />;
    case 'api-keys':
      return <ApiKeysSection />;
    case 'oauth':
      return <OAuthSection />;
    case 'account':
      return <AccountSection />;
    case 'data':
      return <DataPortabilitySection />;
    default:
      return null;
  }
}

/** One settings body, used by the desktop dialog and the mobile profile page. */
export function SettingsSectionBody({ section, fallbackTo }: { section: string; fallbackTo: string }) {
  const body = sectionElement(section);

  if (!body) {
    return <Navigate to={fallbackTo} replace />;
  }

  return <Suspense fallback={<LoadingPage />}>{body}</Suspense>;
}
