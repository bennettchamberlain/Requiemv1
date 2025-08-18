import { Portal } from '@ci/common';
import { Separator, Sidebar } from '@ci/shadcn';

export function PrimaryNavigation() {
  return (
    <header className="flex flex-row items-center justify-between pl-2 pr-4 py-2 border-b">
      <section className="flex flex-row items-center">
        <Sidebar.Trigger />
        <Separator orientation="vertical" className="ml-2 mr-3 data-[orientation=vertical]:h-5" />
        <Portal id="breadcrumbs" />
      </section>

      <section>
        <Portal id="actions" />
      </section>
    </header>
  );
}
