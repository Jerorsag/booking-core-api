import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { REQUEST_SCOPE_METADATA_KEY } from '../context/request-context.constants';
import { RequestContext } from '../context/request-context.interface';
import { RequestWithContext } from '../context/request-context.types';
import { Scope } from '../context/scope.enum';
import { StructuredLoggerService } from '../logging/structured-logger.service';
import {
  generateTraceId,
  normalizeTraceIdHeaderValue,
} from '../utils/trace-id.util';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: StructuredLoggerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest<RequestWithContext>();
    const res = httpContext.getResponse<{ setHeader: (name: string, value: string) => void; statusCode: number }>();

    const scope = this.resolveScope(context);
    const traceId = this.resolveTraceId(req);
    const actorId = this.resolveActorId(req);
    const organizationId = this.resolveOrganizationId(req, scope);
    const requestStartAt = Date.now();

    const requestContext: RequestContext = {
      traceId,
      actorId,
      scope,
      requestStartAt,
      method: req.method,
      path: req.originalUrl ?? req.url,
      ...(organizationId ? { organizationId } : {}),
    };

    req.context = requestContext;
    res.setHeader('x-trace-id', traceId);

    this.logger.info('http.request.started', {
      traceId,
      scope,
      actorId,
      organizationId: organizationId ?? null,
      method: requestContext.method,
      path: requestContext.path,
    });

    return next.handle().pipe(
      tap(() => {
        const durationMs = Date.now() - requestStartAt;

        this.logger.info('http.request.finished', {
          traceId,
          scope,
          actorId,
          organizationId: organizationId ?? null,
          method: requestContext.method,
          path: requestContext.path,
          statusCode: res.statusCode,
          durationMs,
        });
      }),
      catchError((error: unknown) => {
        const durationMs = Date.now() - requestStartAt;
        const errorName =
          error instanceof Error ? error.name : 'UnknownError';
        const errorMessage =
          error instanceof Error ? error.message : 'Unhandled exception';

        this.logger.error('http.request.failed', {
          traceId,
          scope,
          actorId,
          organizationId: organizationId ?? null,
          method: requestContext.method,
          path: requestContext.path,
          statusCode: res.statusCode,
          durationMs,
          errorName,
          errorMessage,
        });

        return throwError(() => error);
      }),
    );
  }

  private resolveScope(context: ExecutionContext): Scope {
    return (
      this.reflector.getAllAndOverride<Scope>(REQUEST_SCOPE_METADATA_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? Scope.SYSTEM
    );
  }

  private resolveTraceId(req: RequestWithContext): string {
    const traceIdFromHeaders =
      normalizeTraceIdHeaderValue(req.headers['x-trace-id']) ??
      normalizeTraceIdHeaderValue(req.headers['x-request-id']);

    return traceIdFromHeaders ?? generateTraceId();
  }

  private resolveActorId(req: RequestWithContext): string | null {
    return req.user?.sub ?? req.user?.id ?? req.user?.userId ?? null;
  }

  private resolveOrganizationId(
    req: RequestWithContext,
    scope: Scope,
  ): string | undefined {
    if (scope !== Scope.TENANT) {
      return undefined;
    }

    const fromUser = req.user?.organizationId?.trim();
    if (fromUser) {
      return fromUser;
    }

    const fromHeader = normalizeTraceIdHeaderValue(
      req.headers['x-organization-id'],
    );
    return fromHeader ?? undefined;
  }
}
