import { Request } from 'express';
import { RequestContext } from './request-context.interface';

export interface RequestUser {
  sub?: string;
  id?: string;
  userId?: string;
  organizationId?: string;
  jti?: string;
  tokenType?: 'access' | 'refresh' | 'onboarding';
  role?: string;
  systemRole?: string;
  roles?: string[];
}

export interface RequestWithContext extends Request {
  context?: RequestContext;
  user?: RequestUser;
}
