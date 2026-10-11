import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from './auth-user';
import { IS_PUBLIC_KEY } from './decorators';
import { TokenVerifier } from './token-verifier';

interface AuthRequest {
  headers: { authorization?: string };
  user?: AuthUser;
}

/**
 * Registered globally: every route requires a valid bearer token unless marked @Public().
 * Secure by default, so a new endpoint can't be left unprotected by forgetting a decorator.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      request.user = await this.verifier.verify(token);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error; // e.g. 403 from a valid token without company or role
      }
      // Don't echo verification details (which check failed) back to the caller, but keep the
      // reason for operators at debug level (e.g. ERR_JWT_EXPIRED, a wrong "iss"). Never the token.
      const { code, claim } = error as { code?: string; claim?: string };
      this.logger.debug({ code, claim }, 'token rejected');
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}
