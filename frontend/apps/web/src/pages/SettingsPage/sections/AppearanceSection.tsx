import { Card, cn } from '@ci/shadcn';

import { ColorPicker, TexturePicker, useTheme } from '@/components/ThemePicker';

const THEME_MODES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
] as const;

export function AppearanceSection() {
  const { themeState, setTheme } = useTheme();

  return (
    <>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground mt-1">Customize the look and feel of your interface.</p>
      </div>

      <Card>
        <Card.Content className="flex flex-col gap-6">
          <div>
            <p className="mb-2 text-sm font-medium">Theme</p>
            <div role="radiogroup" aria-label="Theme" className="flex gap-1 rounded-md bg-muted p-1 text-xs">
              {THEME_MODES.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  role="radio"
                  aria-checked={themeState.mode === entry.value}
                  onClick={() => setTheme(entry.value)}
                  className={cn(
                    'flex-1 cursor-pointer rounded-sm px-2 py-1.5 transition-colors',
                    themeState.mode === entry.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <ColorPicker />
            </div>
            <div className="border-t border-border pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
              <TexturePicker />
            </div>
          </div>
        </Card.Content>
      </Card>
    </>
  );
}
