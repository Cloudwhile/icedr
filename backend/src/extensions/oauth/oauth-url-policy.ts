import { validateOutboundHttpUrl } from '../../common/security/outbound-http-policy';

export function validateOAuthHttpUrl(
  value: string | URL,
  options: { label: string; production: boolean },
) {
  return validateOutboundHttpUrl(value, options);
}
