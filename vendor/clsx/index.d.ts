export type ClassValue = string | number | ClassDictionary | ClassArray | undefined | null | boolean
export interface ClassDictionary {
  [id: string]: any
}
export interface ClassArray extends Array<ClassValue> {}
export default function clsx(...inputs: ClassValue[]): string
export { clsx }
