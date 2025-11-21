import * as React from 'react'
export type Primitive = React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLElement> & { asChild?: boolean; children?: React.ReactNode; [key: string]: any } &
    React.RefAttributes<HTMLElement>
>
export const Root: Primitive
export const Portal: React.FC<React.PropsWithChildren>
export const Trigger: Primitive
export const Content: Primitive
export const Group: Primitive
export const Label: Primitive
export const Item: Primitive
export const CheckboxItem: Primitive
export const RadioGroup: Primitive
export const RadioItem: Primitive
export const ItemIndicator: Primitive
export const Separator: Primitive
export const Sub: Primitive
export const SubTrigger: Primitive
export const SubContent: Primitive
export default Root
