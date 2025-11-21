import { ClassValue } from 'clsx'
export interface VariantOptions {
  [key: string]: Record<string, ClassValue>
}
export interface CompoundVariant {
  class?: ClassValue
  [key: string]: any
}
export interface CvaOptions {
  variants?: VariantOptions
  defaultVariants?: Record<string, any>
  compoundVariants?: CompoundVariant[]
}
export type VariantProps<T> = T extends (props: infer P) => any ? P : never
export declare function cva(base?: ClassValue, options?: CvaOptions): (props?: Record<string, any>) => string
export default cva
