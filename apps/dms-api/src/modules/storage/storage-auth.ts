import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

// The provider must reject anonymous object reads. Check on each operation so a backend
// restart with missing/invalid IAM configuration cannot turn a signed capability into
// an unchecked request. Direct Node transport never uses ambient proxy settings.
export function storageAuthenticationRequired(endpoint: URL): Promise<boolean> {
  return new Promise((resolve) => {
    const request = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: '/dms-auth-required-probe/object',
        method: 'HEAD',
        timeout: 1500,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 403);
      },
    );
    request.on('error', () => resolve(false));
    request.on('timeout', () => request.destroy());
    request.end();
  });
}
