export interface JwtPayload {
  sub: string;
  systemRole: string;
  organizationId?: string;
  jti?: string;
  tokenType: 'access' | 'refresh' | 'onboarding';
}
