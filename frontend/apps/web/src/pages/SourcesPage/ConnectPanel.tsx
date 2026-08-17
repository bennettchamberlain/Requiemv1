import { ConnectedAccountsSection } from '@/components/connect/ConnectedAccountsSection';
import { ServiceIntegrationsSection } from '@/components/connect/ServiceIntegrationsSection';

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
      <ConnectedAccountsSection />

      <section className="w-full">
        {/* The cards name what each service hands over, so the standfirst no
            longer lists it too. What is left is the part they cannot say. */}
        <h2 className="mb-1 text-2xl font-bold">Services</h2>
        <p className="text-muted-foreground mb-6">
          Sign in once; Companion keeps pulling on its own. Nothing leaves this appliance.
        </p>
        <ServiceIntegrationsSection variant="page" />
      </section>
    </div>
  );
}
