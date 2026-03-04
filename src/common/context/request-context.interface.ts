import { Scope } from './scope.enum';

export interface RequestContext {
  traceId: string;
  actorId: string | null;
  scope: Scope;
  organizationId?: string;
  requestStartAt: number;
  method: string;
  path: string;
}
