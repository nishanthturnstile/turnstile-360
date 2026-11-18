// Created only from verified request identity and the server-generated request ID.
export interface ConfigurationActor {
  deploymentMode?: 'read' | 'full';
  userId: string;
  requestId: string;
  accessFingerprint?: string;
  deadlineAt?: number;
}
