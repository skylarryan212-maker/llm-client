const React = require('react')

const ThemeContext = React.createContext({
  theme: 'light',
  setTheme: () => {},
  resolvedTheme: 'light',
})

function resolveSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyThemeClass(attribute, nextTheme) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (attribute === 'class') {
    root.classList.remove('light', 'dark')
    root.classList.add(nextTheme)
  } else if (attribute) {
    root.setAttribute(attribute, nextTheme)
  }
}

function ThemeProvider({
  children,
  attribute = 'class',
  defaultTheme = 'system',
  enableSystem = true,
  forcedTheme,
}) {
  const initialTheme = forcedTheme || (defaultTheme === 'system' && enableSystem ? resolveSystemTheme() : defaultTheme)
  const [theme, setTheme] = React.useState(initialTheme)

  const resolvedTheme = forcedTheme || (theme === 'system' && enableSystem ? resolveSystemTheme() : theme)

  React.useEffect(() => {
    applyThemeClass(attribute, resolvedTheme)
  }, [attribute, resolvedTheme])

  const value = React.useMemo(
    () => ({ theme, setTheme, resolvedTheme }),
    [theme, resolvedTheme]
  )

  return React.createElement(ThemeContext.Provider, { value }, children)
}

function useTheme() {
  return React.useContext(ThemeContext)
}

module.exports = { ThemeProvider, useTheme }
