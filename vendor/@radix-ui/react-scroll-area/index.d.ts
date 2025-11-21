import * as React from 'react'
export const Root: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & { [key: string]: any } & React.RefAttributes<HTMLDivElement>
>
export const Viewport: typeof Root
export const ScrollAreaScrollbar: typeof Root
export const ScrollAreaThumb: typeof Root
export const Corner: typeof Root
export default Root
