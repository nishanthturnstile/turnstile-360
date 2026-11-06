import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { S3Storage } from './s3-storage.js';
import {
  type StorageRole,
  storageConfiguration,
  storageCredentials,
} from './storage-configuration.js';

// Internal owning use cases only. No upload/download issuing route ships before admission.
@Injectable()
export class StorageService implements OnApplicationShutdown {
  private readonly clients = new Map<StorageRole, S3Storage>();
  forRole(role: StorageRole) {
    let client = this.clients.get(role);
    if (!client) {
      client = new S3Storage(
        storageConfiguration(process.env),
        role,
        storageCredentials(process.env, role),
      );
      this.clients.set(role, client);
    }
    return client;
  }
  onApplicationShutdown() {
    for (const client of this.clients.values()) client.close();
  }
}
