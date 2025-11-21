import * as React from 'react'
export interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: string
  attribute?: string
  enableSystem?: boolean
}
export declare function ThemeProvider(props: ThemeProviderProps): React.ReactElement
export declare function useTheme(): { theme: string; setTheme: (theme: string) => void; resolvedTheme: string }
