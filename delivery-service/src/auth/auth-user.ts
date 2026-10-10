export enum Role {
  Dispatcher = 'dispatcher',
  Driver = 'driver',
}

/** The caller, built only from a verified token. Never from request input. */
export interface AuthUser {
  /** Keycloak user id (`sub`). For drivers this is the `assigned_driver_id` on orders. */
  sub: string;
  /** Tenant boundary: every orders query is scoped by this value. */
  companyId: string;
  role: Role;
}
