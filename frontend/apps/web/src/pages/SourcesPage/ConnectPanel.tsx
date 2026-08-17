import { ConnectedAccountsSection } from '@/components/connect/ConnectedAccountsSection';
import { ServiceIntegrationsSection } from '@/components/connect/ServiceIntegrationsSection';

import { PathHeader } from './PathHeader';

/**
 * The services half: accounts you sign into, and what is already signed in.
 *
 * The browser extension and Capture used to live under this, below the whole
 * service catalogue — which put the two sources nothing else can substitute
 * (what you read, what you do on your own machine) behind a scroll past a
 * hundred services. They are their own paths now.
 */
export function ConnectPanel() {
  return (
    <div className="w-full">
      <PathHeader path="connect" />

      <ConnectedAccountsSection />

      <ServiceIntegrationsSection variant="page" />
    </div>
  );
}
