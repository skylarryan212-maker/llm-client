import * as React from 'react';

export type Importer<P = any> = () => Promise<{ default: React.ComponentType<P> } | React.ComponentType<P>>;
export type SideCarComponent<P = any> = React.ComponentType<P> & { __sidecar__?: Importer<P> };

export function useSidecar<P = any>(importer: Importer<P>, component?: SideCarComponent<P> | null): SideCarComponent<P>;
export function sidecar<P = any>(importer: Importer<P>): SideCarComponent<P>;
export function exportSidecar<P = any>(importer: Importer<P>, component?: SideCarComponent<P> | null): SideCarComponent<P>;
export function renderCar<P = any>(Comp?: SideCarComponent<P>, props?: P): React.ReactElement | null;

export default useSidecar;
