import { type ComponentType, type SVGProps } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';

import { PageContent } from '@/components/layout';

export interface Job {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'scheduled';
  readonly priority: 'low' | 'medium' | 'high' | 'urgent';
  readonly category: 'personal' | 'work' | 'health' | 'learning' | 'entertainment' | 'travel' | 'shopping';
  readonly scheduledFor?: Date;
  readonly estimatedDuration: number; // in minutes
  readonly progress?: number; // 0-100
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>;
  readonly color: string;
  readonly tags: string[];
  readonly recurring?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    nextOccurrence: Date;
  };
}

export function JobsPage() {
  usePageTitle('Jobs - Companion Intelligence');

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
              <Breadcrumb.Page>Jobs</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
          <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
        </div>
      </PageContent>
    </>
  );
}
