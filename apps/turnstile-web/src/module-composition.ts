import type { BusinessModuleId } from '@thaarei/turnstile-contracts';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { ModulePageProps } from './components/module-entry';
export type SelectedModuleRoute = {
  id: BusinessModuleId;
  path: string;
  Component: LazyExoticComponent<ComponentType<ModulePageProps>>;
};
// Selected builds replace this registry. No unselected implementation is imported.
export const selectedModuleRoutes: SelectedModuleRoute[] = [];
