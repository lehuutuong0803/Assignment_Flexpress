import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { AuthUser, Role } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Opts a route out of authentication (health, metrics, docs). Everything else requires a token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the given roles. Without it, any authenticated user may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** The verified caller, set by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
