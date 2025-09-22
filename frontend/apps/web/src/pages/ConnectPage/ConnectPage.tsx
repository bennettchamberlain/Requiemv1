import { Portal } from '@ci/common';
import { Breadcrumb, cn } from '@ci/shadcn';

import { PageContent } from '@/components/layout';

export function ConnectPage() {
  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Connect</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 max-w-[1040px] mx-auto">
          <Card
            logo="/branding/microsoft/logo.svg"
            background="bg-sky-400"
            border="border-sky-300"
            text="Bring your Microsoft account into the mix for email and scheduling. Keep track of what matters without extra steps."
          />
          <Card
            logo="/branding/google/logo.svg"
            background="bg-violet-400"
            border="border-violet-300"
            text="Link your Google account for quick access to Gmail, Calendar, and Drive. Everything you need, always in sync."
          />
          <Card
            logo="/branding/meta/logo.svg"
            background="bg-blue-500"
            border="border-blue-400"
            text="Sync with Meta to stay connected with your community, manage Marketplace items, and track your Quest activity."
          />
        </div>
      </PageContent>
    </>
  );
}

interface CardProps {
  className?: string;
  background: string;
  border: string;
  logo: string;
  text: string;
}

function Card({ className, background, border, logo, text }: CardProps) {
  return (
    <div
      className={cn(
        'text-gray-700 dark:text-gray-200 rounded-lg bg-white shadow-md dark:bg-gray-800 dark:text-gray-200',
        className,
      )}
    >
      <div className={cn('flex items-center justify-center p-10 rounded-t-lg', background)}>
        <div
          className={cn(
            'flex items-center justify-center p-6 rounded-full bg-white aspect-square border-6',
            border,
          )}
        >
          <img src={logo} className="w-12 h-12" />
        </div>
      </div>
      <div className="font-semibold p-6 py-10">{text}</div>
    </div>
  );
}
