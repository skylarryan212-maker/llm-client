import * as React from 'react'
export interface SyntaxHighlighterProps extends React.HTMLAttributes<HTMLPreElement> {
  language?: string
  style?: React.CSSProperties
  customStyle?: React.CSSProperties
}
export declare const Prism: React.FC<SyntaxHighlighterProps>
export default Prism
