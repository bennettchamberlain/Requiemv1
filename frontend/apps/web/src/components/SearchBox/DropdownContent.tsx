import { EntityTypeFilter } from './EntityTypeFilter';
import { Button } from '@ci/shadcn';
import { Save } from '@ci/shadcn/icons';

export function DropdownContent() {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="p-4">
        <h3 className="text-xs font-bold uppercase">Filters</h3>

      <EntityTypeFilter />
      </div>
      <Button
        className="bg-green-600 hover:bg-green-700 text-white mr-2"
        onClick={() => {}}
      >
        <Save className="mr-2 h-4 w-4" />
        Save Search
      </Button>
    </div>
  );
}
