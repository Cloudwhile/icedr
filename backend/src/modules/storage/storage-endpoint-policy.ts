import { validateOutboundHttpUrl } from '../../common/security/outbound-http-policy';

export function validateStorageEndpoint(endpoint: string) {
  return validateOutboundHttpUrl(endpoint, {
    label: 'Object storage endpoint',
    production: false,
  });
}
