import { z } from 'zod';

const slug = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .min(3)
  .max(64);
export const moduleRegistrationSchema = z.strictObject({
  enabled: z.boolean().optional(),
  id: slug.refine((id) => id !== 'foundation'),
  title: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  permission: z.string().regex(/^turnstile:[a-z][a-z0-9-]*:read$/),
  requires: z.array(slug).max(64),
  optionalIntegrations: z.array(slug).max(64),
});
export type ModuleRegistration = z.infer<typeof moduleRegistrationSchema>;
export function isModuleEnabled(module: ModuleRegistration): boolean {
  return module.enabled !== false;
}
export function defineModules<const T extends readonly ModuleRegistration[]>(modules: T): T {
  z.array(moduleRegistrationSchema).max(1024).parse(modules);
  if (modules.filter(isModuleEnabled).length > 63)
    throw new Error('At most 63 active business modules are supported');
  if (modules.some((module) => module.permission === 'turnstile:units:read'))
    throw new Error('Foundation permission cannot be reassigned to a business module');
  const ids = new Set(modules.map((m) => m.id));
  const permissions = new Set(modules.map((m) => m.permission));
  if (ids.size !== modules.length || permissions.size !== modules.length)
    throw new Error('Duplicate module identity or permission');
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (id === 'foundation' || visited.has(id)) return;
    if (visiting.has(id)) throw new Error('Module dependency cycle');
    const entry = modules.find((m) => m.id === id);
    if (!entry) throw new Error('Unknown module dependency');
    if (
      new Set(entry.requires).size !== entry.requires.length ||
      new Set(entry.optionalIntegrations).size !== entry.optionalIntegrations.length
    )
      throw new Error('Duplicate module dependency');
    visiting.add(id);
    for (const dependency of entry.requires) {
      if (
        isModuleEnabled(entry) &&
        dependency !== 'foundation' &&
        !modules.some((m) => m.id === dependency && isModuleEnabled(m))
      )
        throw new Error('Active module depends on a retired module');
      visit(dependency);
    }
    for (const optional of entry.optionalIntegrations)
      if (
        !ids.has(optional) ||
        optional === id ||
        (isModuleEnabled(entry) && !modules.some((m) => m.id === optional && isModuleEnabled(m)))
      )
        throw new Error('Unknown optional integration');
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  return modules;
}

// The single source of supported business modules. Source entrypoints follow the module ID.
// Classification is separately owned by the released central catalogue.
export const MODULE_REGISTRY = defineModules([
  {
    id: 'incident-management',
    title: 'Incident Management',
    version: '1.0.0',
    permission: 'turnstile:incidents:read',
    requires: ['foundation'],
    optionalIntegrations: [],
  },
  {
    id: 'risk-management',
    title: 'Risk Management',
    version: '1.0.0',
    permission: 'turnstile:risks:read',
    requires: ['foundation'],
    optionalIntegrations: [],
  },
]);

export const ACTIVE_MODULE_REGISTRY = MODULE_REGISTRY.filter(isModuleEnabled);
