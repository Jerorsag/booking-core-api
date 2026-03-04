import { SetMetadata } from '@nestjs/common';
import { REQUEST_SCOPE_METADATA_KEY } from '../context/request-context.constants';
import { Scope } from '../context/scope.enum';

export const RequestScope = (scope: Scope) =>
  SetMetadata(REQUEST_SCOPE_METADATA_KEY, scope);
