import * as React from 'react'
export type Primitive = React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLElement> & { asChild?: boolean; children?: React.ReactNode; [key: string]: any } &
    React.RefAttributes<HTMLElement>
>
export const Root: Primitive
export const Group: Primitive
export const Value: Primitive
export const Trigger: Primitive
export const Icon: Primitive
export const Portal: React.FC<React.PropsWithChildren>
export const Content: Primitive
export const Viewport: Primitive
export const Label: Primitive
export const Item: Primitive
export const ItemIndicator: Primitive
export const ItemText: Primitive
export const Separator: Primitive
export const ScrollUpButton: Primitive
export const ScrollDownButton: Primitive
export default Root
