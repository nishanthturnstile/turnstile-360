import { SetMetadata } from '@nestjs/common';

export const WORKSPACE_READINESS_EXEMPT = Symbol('workspaceReadinessExempt');
// Exempts only readiness; identity, CSRF and route permissions still apply.
export const WorkspaceReadinessExempt = () => SetMetadata(WORKSPACE_READINESS_EXEMPT, true);

export const DEPLOYMENT_EXEMPT = Symbol('deploymentExempt');
export const DeploymentExempt = () => SetMetadata(DEPLOYMENT_EXEMPT, true);
