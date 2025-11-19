import { type CSSProperties, useMemo, useState } from 'react';

import { Button, Card, Tabs } from '@ci/shadcn';
import { Palette, Settings2 } from '@ci/shadcn/icons';

import { useTheme } from '@/hooks';
import {
  PRESET_THEMES,
  TEXTURE_PATTERNS,
  buildTextureBackground,
  readTexturePalette,
  DEFAULT_TEXTURE_PALETTE,
  DEFAULT_TEXTURE_ID,
} from '@/hooks/use-theme';

import { ColorWheel } from './ColorWheel';

const TEXTURE_OPACITY_MIN = 0;
const TEXTURE_OPACITY_MAX = 0.8;
const TEXTURE_OPACITY_STEP = 0.05;

export function ThemePicker() {
  const { themeState, setColorTheme, setCustomColor, setTexture, setTextureOpacity } = useTheme();
  const [customHue, setCustomHue] = useState(themeState.colorTheme.baseHue);
  const texturePalette = useMemo(
    () => readTexturePalette() ?? DEFAULT_TEXTURE_PALETTE,
    [themeState.mode, themeState.colorTheme],
  );
  const textureOpacity = themeState.textureOpacity;

  const texturePreviews = useMemo<Record<string, CSSProperties>>(() => {
    return Object.fromEntries(
      TEXTURE_PATTERNS.map((pattern) => {
        const image = buildTextureBackground(pattern.id, texturePalette, textureOpacity, {
          preview: true,
        });

        return [
          pattern.id,
          {
            backgroundImage: image === 'none' ? undefined : image,
            backgroundSize: pattern.size,
            backgroundRepeat: pattern.repeat ?? 'repeat',
            backgroundColor: texturePalette.background,
          },
        ];
      }),
    );
  }, [texturePalette, textureOpacity]);

  const handlePresetSelect = (preset: (typeof PRESET_THEMES)[0]) => {
    setColorTheme(preset);
  };

  const handleCustomColorChange = (hue: number) => {
    setCustomHue(hue);
  };

  const handleCustomColorApply = (hue: number) => {
    setCustomColor(hue);
  };

  const isCustomSelected = themeState.colorTheme.isCustom;
  const isPresetSelected = (preset: (typeof PRESET_THEMES)[0]) =>
    !isCustomSelected && preset.baseHue === themeState.colorTheme.baseHue;

  const selectedTexture = TEXTURE_PATTERNS.find((pattern) => pattern.id === themeState.textureId);

  return (
    <Card className="w-full">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <Tabs defaultValue="presets" className="w-full">
            <Tabs.List className="grid w-full grid-cols-2">
              <Tabs.Trigger value="presets" className="flex items-center gap-2">
                <Palette className="h-4 w-4" />
                Presets
              </Tabs.Trigger>
              <Tabs.Trigger value="custom" className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Custom
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="presets" className="p-4 space-y-4">
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Choose a color theme</h3>
                <div className="grid grid-cols-3 gap-2">
                  {PRESET_THEMES.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => handlePresetSelect(preset)}
                      className={`
                        group relative aspect-square rounded-md border-2 transition-all
                        ${
                          isPresetSelected(preset)
                            ? 'border-primary ring-2 ring-primary/20'
                            : 'border-border hover:border-primary/50'
                        }
                      `}
                      title={preset.name}
                    >
                      <div
                        className="absolute inset-0.5 rounded-sm"
                        style={{
                          background:
                            preset.baseHue === -1
                              ? 'linear-gradient(135deg, #2a2a2a, #3a3a3a, #4a4a4a)'
                              : preset.baseHue === -2
                                ? 'linear-gradient(135deg, #fafafa, #f0f0f0, #e0e0e0)'
                                : preset.baseHue === -3
                                  ? 'linear-gradient(135deg, #129, #208, #279)'
                                  : `linear-gradient(135deg,
                            oklch(0.3 0.15 ${preset.baseHue}),
                            oklch(0.5 0.12 ${preset.baseHue}),
                            oklch(0.7 0.08 ${preset.baseHue})
                          )`,
                        }}
                      />

                      {isPresetSelected(preset) && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-2 h-2 bg-white rounded-full border border-gray-300" />
                        </div>
                      )}

                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity rounded-md" />
                    </button>
                  ))}
                </div>

                {!isCustomSelected && (
                  <div className="text-center pt-2">
                    <span className="text-sm text-muted-foreground">{themeState.colorTheme.name}</span>
                  </div>
                )}
              </div>
            </Tabs.Content>

            <Tabs.Content value="custom" className="p-4 space-y-4">
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Pick any color</h3>

                <div className="flex justify-center">
                  <ColorWheel
                    size={180}
                    value={customHue < 0 ? 0 : customHue}
                    onChange={handleCustomColorChange}
                    onChangeEnd={handleCustomColorApply}
                  />
                </div>

                <div className="flex gap-2 justify-center">
                  <Button
                    variant={customHue === -1 ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setCustomHue(-1);
                      setCustomColor(-1);
                    }}
                    className="text-xs"
                  >
                    Dark Gray
                  </Button>
                  <Button
                    variant={customHue === -2 ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setCustomHue(-2);
                      setCustomColor(-2);
                    }}
                    className="text-xs"
                  >
                    Light Gray
                  </Button>
                  <Button
                    variant={customHue === -3 ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setCustomHue(-3);
                      setCustomColor(-3);
                    }}
                    className="text-xs"
                  >
                    Original
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Preview</span>
                    <span className="text-xs text-muted-foreground">
                      {customHue === -1
                        ? 'Dark Gray'
                        : customHue === -2
                          ? 'Light Gray'
                          : customHue === -3
                            ? 'Original'
                            : `${customHue}° HSL`}
                    </span>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: 'BG', lightness: 0.129 },
                      { label: 'Card', lightness: 0.208 },
                      { label: 'Secondary', lightness: 0.279 },
                      { label: 'Accent', lightness: 0.4 },
                      { label: 'Primary', lightness: 0.6 },
                    ].map((swatch) => (
                      <div key={swatch.label} className="space-y-1">
                        <div
                          className="aspect-square rounded border border-border"
                          style={{
                            backgroundColor:
                              customHue === -1
                                ? `oklch(${swatch.lightness + 0.05} 0 0)`
                                : customHue === -2
                                  ? `oklch(${0.9 - swatch.lightness * 0.5} 0.005 60)`
                                  : customHue === -3
                                    ? swatch.lightness < 0.3
                                      ? `oklch(${swatch.lightness} 0.042 264)`
                                      : `oklch(${swatch.lightness + 0.4} 0.013 255)`
                                    : `oklch(${swatch.lightness} 0.12 ${customHue})`,
                          }}
                        />
                        <div className="text-xs text-center text-muted-foreground">{swatch.label}</div>
                      </div>
                    ))}
                  </div>

                  {isCustomSelected && (
                    <div className="text-center pt-2">
                      <span className="text-sm text-muted-foreground">{themeState.colorTheme.name}</span>
                    </div>
                  )}
                </div>
              </div>
            </Tabs.Content>
          </Tabs>
        </div>

        <div className="border-t border-border pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Surface Texture</h3>
              <p className="text-xs text-muted-foreground">Hero-inspired SVG patterns</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTexture(DEFAULT_TEXTURE_ID)}
              disabled={themeState.textureId === DEFAULT_TEXTURE_ID}
              className="text-xs"
            >
              Clear
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {TEXTURE_PATTERNS.map((pattern) => {
              const isSelected = pattern.id === themeState.textureId;
              const styles = texturePreviews[pattern.id] ?? {
                backgroundColor: texturePalette.background,
              };

              return (
                <button
                  key={pattern.id}
                  onClick={() => setTexture(pattern.id)}
                  className={`
                  group relative rounded-lg border p-2 text-left transition-all focus-visible:outline-none
                  ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-border hover:border-primary/40'
                  }
                `}
                  title={pattern.description}
                >
                  <div
                    className="aspect-square w-full rounded-md border border-border overflow-hidden"
                    style={styles}
                  />
                  <div className="mt-2 text-xs font-medium text-foreground">{pattern.name}</div>
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Texture opacity</span>
              <span>{Math.round(textureOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={TEXTURE_OPACITY_MIN}
              max={TEXTURE_OPACITY_MAX}
              step={TEXTURE_OPACITY_STEP}
              value={textureOpacity}
              onChange={(event) => setTextureOpacity(parseFloat(event.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Subtle</span>
              <span>Bold</span>
            </div>
          </div>

          {selectedTexture && (
            <p className="text-xs text-muted-foreground text-center">{selectedTexture.description}</p>
          )}
        </div>
      </div>
    </Card>
  );
}
