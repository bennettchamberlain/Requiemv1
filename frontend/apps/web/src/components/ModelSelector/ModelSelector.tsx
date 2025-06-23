import { Select } from '@ci/shadcn';

import { useModel } from '@/hooks';

export function ModelSelector() {
  const [{ selectedModel, activeModels, error }, { selectModel }] = useModel();

  if (error) {
    return null;
  }

  return (
    <Select value={selectedModel ?? undefined} onValueChange={selectModel}>
      <Select.Trigger className="w-[150px]">
        <Select.Value placeholder="Active model" />
      </Select.Trigger>
      <Select.Content>
        {activeModels.map((model) => (
          <Select.Item key={model.model} value={model.model}>
            {model.model}
          </Select.Item>
        ))}
      </Select.Content>
    </Select>
  );
}
