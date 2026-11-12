import { GuardedModuleEntry, type ModulePageProps } from '@/components/module-entry';
export default function IncidentManagement(props: ModulePageProps) {
  return <GuardedModuleEntry {...props} id="incident-management" title="Incident Management" />;
}
