const React = require('react')

const ThemeContext = React.createContext({
  theme: 'light',
  setTheme: () => {},
  resolvedTheme: 'light',
})

function ThemeProvider({ children, defaultTheme = 'light', ...props }) {
  const [theme, setTheme] = React.useState(defaultTheme)
  const value = React.useMemo(() => ({ theme, setTheme, resolvedTheme: theme }), [theme])
  return React.createElement(ThemeContext.Provider, { value }, children)
}

function useTheme() {
  return React.useContext(ThemeContext)
}

module.exports = { ThemeProvider, useTheme }
