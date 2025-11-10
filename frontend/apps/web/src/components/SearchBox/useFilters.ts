import { useCallback, useState } from 'react';

import { createHookContext } from '@ci/common';

type ReturnType = [
  {
    isFiltersPanelVisible: boolean;
  },
  {
    toggleFilterPanel: () => void;
  },
];

function useFilters(): ReturnType {
  const [isFiltersPanelVisible, setFilterPanelVisibile] = useState(false);

  const toggleFilterPanel = useCallback(() => {
    setFilterPanelVisibile((prev) => !prev);
  }, []);

  return [
    {
      isFiltersPanelVisible,
    },
    {
      toggleFilterPanel,
    },
  ];
}

const { Provider: FiltersProvider, useHookContext: useFiltersContext } = createHookContext(useFilters);

export { FiltersProvider, useFiltersContext as useFilters };
