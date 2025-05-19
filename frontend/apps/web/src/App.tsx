import { Counter } from '@ci/common';
import { Counter as CounterThingo } from '@ci/thingo';
import { useListUsers } from './services/use-list-users';

// test button - @todo remove
import { Button } from "@/components/ui/button"

// test theming - @todo remove
import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider")

  return context
}

function App() {
  const { users, loading } = useListUsers();

  const astronautSalvage = () => {
    alert('You saved the astronaut!!');
  };

  return (
    <>

      <ThemeProvider/>

      <div className="flex flex-col items-center justify-center min-h-svh">
        <Button onClick={astronautSalvage}>Save the Astronaut!</Button>
      </div>

      <div className="card">
        <h2>Current users:</h2>
        {!loading && users.map((user) => <div key={user.id}>{user.name}</div>)}
      </div>

      <div className="card">
        <h2>Yarn Workspaces Test</h2>
        <p>These counters should maintain separate state.</p>

        <Counter />
        <CounterThingo />
      </div>
    </>
  );
}

export default App;
