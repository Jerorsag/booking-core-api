import { Request } from 'express';
import { RequestContext } from './request-context.interface';

export interface RequestUser {
  sub?: string;
  id?: string;
  userId?: string;
  organizationId?: string;
}

export interface RequestWithContext extends Request {
  context?: RequestContext;
  user?: RequestUser;
}
