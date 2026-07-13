export type AuthenticationMethods = {
  password: boolean;
  oauth: boolean;
  passkey: boolean;
  recoveryCodes: number;
};

export function buildAuthenticationMethodStatus(
  methods: AuthenticationMethods,
  configuredMinimum: number | null | undefined,
) {
  const methodCount =
    Number(methods.password) + Number(methods.oauth) + Number(methods.passkey);
  const minimumAuthenticationMethods = Math.max(1, configuredMinimum ?? 1);

  return {
    compliant: methodCount >= minimumAuthenticationMethods,
    methodCount,
    minimumAuthenticationMethods,
    methods,
  };
}
