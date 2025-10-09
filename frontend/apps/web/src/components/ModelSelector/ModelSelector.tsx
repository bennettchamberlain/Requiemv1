import { Select, Toggle } from '@ci/shadcn';
import { Brain, Wrench } from '@ci/shadcn/icons';

import { useModel } from '@/hooks';

interface Props {
  withToggles?: boolean;
}

export function ModelSelector({ withToggles = false }: Props) {
  const [
    { selectedModel, thinkingEnabled, toolsEnabled, activeModels, error },
    { selectModel, toggleThinking, toggleTools },
  ] = useModel();

  if (error) {
    return null;
  }

  const selector = (
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

  if (!withToggles) {
    return selector;
  }

  return (
    <div className="flex flex-row">
      <div className="flex flex-row items-center mr-2 gap-1">
        <Toggle
          pressed={toolsEnabled}
          onPressedChange={toggleTools}
          size="sm"
          variant="outline"
          aria-label="Toggle tools"
        >
          <Wrench />
        </Toggle>
        <Toggle
          pressed={thinkingEnabled}
          onPressedChange={toggleThinking}
          size="sm"
          variant="outline"
          aria-label="Toggle thinking"
        >
          <Brain />
        </Toggle>
      </div>

      {selector}
    </div>
  );
}
