import { GuardedModuleEntry, type ModulePageProps } from '@/components/module-entry';
export default function RiskManagement(props: ModulePageProps) {
  return <GuardedModuleEntry {...props} id="risk-management" title="Risk Management" />;
}
