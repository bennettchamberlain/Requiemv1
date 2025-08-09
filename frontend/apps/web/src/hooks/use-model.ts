import { useCallback, useEffect, useState } from 'react';

import { createHookContext, fetchJson } from '@ci/common';

const ACTIVE_MODEL_KEY = 'activeModel';

interface Model {
  model: string;
  namespace: string | null;
  name: string;
  tag: string | null;
}

type Value = [
  {
    selectedModel: string | null;
    activeModels: Model[];
    loading: boolean;
    error: Error | null;
  },
  {
    selectModel: (model: string | null) => void;
  },
];

function useModelLogic(authToken?: string | null | undefined): Value {
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [activeModels, setActiveModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const selectModel = useCallback(
    (model: string | null) => {
      setSelectedModel(model);

      if (model) {
        localStorage.setItem(ACTIVE_MODEL_KEY, model);
      } else {
        localStorage.removeItem(ACTIVE_MODEL_KEY);
      }
    },
    [],
  );

  useEffect(() => {
    if (!authToken) {
      setLoading(false);
      setActiveModels([]);
      setSelectedModel(null);
      return;
    }

    (async () => {
      try {
        const data: Model[] = await fetchJson('/api/llm/models', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
        });

        setActiveModels(data);

        const persistedModel = localStorage.getItem(ACTIVE_MODEL_KEY);
        const selectedModel = data.find((model) => model.model === persistedModel)
          ? persistedModel
          : (data[0]?.model ?? null);

        selectModel(selectedModel);
      } catch (error: unknown) {
        setError(error as Error);
        setActiveModels([]);
        setSelectedModel(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [authToken, selectModel]);

  return [
    {
      selectedModel,
      activeModels,
      loading,
      error,
    },
    {
      selectModel,
    },
  ];
}

const { Provider, useHookContext } = createHookContext(useModelLogic, 'useModel');

export { Provider as ModelProvider, useHookContext as useModel };
