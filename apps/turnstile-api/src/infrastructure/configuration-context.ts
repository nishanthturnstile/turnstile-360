// Created only from verified request identity and the server-generated request ID.
export interface ConfigurationActor {
  userId: string;
  requestId: string;
  accessFingerprint?: string;
  deadlineAt?: number;
}
