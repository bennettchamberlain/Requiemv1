import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface VoiceModeContextValue {
  isVoiceModeActive: boolean;
  toggleVoiceMode: () => void;
}

const VoiceModeContext = createContext<VoiceModeContextValue | undefined>(undefined);

interface VoiceModeProviderProps {
  children: ReactNode;
}

export function VoiceModeProvider({ children }: VoiceModeProviderProps) {
  const [isVoiceModeActive, setIsVoiceModeActive] = useState(false);

  const toggleVoiceMode = useCallback(() => {
    setIsVoiceModeActive((prev) => !prev);
  }, []);

  const value: VoiceModeContextValue = {
    isVoiceModeActive,
    toggleVoiceMode,
  };

  return <VoiceModeContext.Provider value={value}>{children}</VoiceModeContext.Provider>;
}

export function useVoiceModeContext() {
  const context = useContext(VoiceModeContext);
  if (context === undefined) {
    throw new Error('useVoiceModeContext must be used within a VoiceModeProvider');
  }

  return context;
}
