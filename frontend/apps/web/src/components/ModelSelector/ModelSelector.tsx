import { Select, Toggle } from '@ci/shadcn';
import { Brain, Eye, Wrench } from '@ci/shadcn/icons';

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
            <div className="flex w-full items-center justify-between gap-2">
              <span className="truncate">{model.model}</span>

              <span className="ml-3 flex items-center gap-1 text-muted-foreground">
                {model.thinking === true && <Brain className="size-3.5" aria-label="Supports thinking" />}
                {model.tools === true && <Wrench className="size-3.5" aria-label="Supports tools" />}
                {model.vision === true && <Eye className="size-3.5" aria-label="Supports vision" />}
              </span>
            </div>
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
