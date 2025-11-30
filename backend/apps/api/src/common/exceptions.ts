/**
 * Exception thrown when a system user attempts to perform
 * an operation that requires a real user context.
 *
 * This is a domain exception that should be caught and handled
 * appropriately by the calling layer (controller, resolver, etc.).
 *
 * @example
 * ```typescript
 * if (context.userId === SYSTEM_USER) {
 *   throw new InvalidSystemUserOperationException('Cannot create user-owned entities as system user');
 * }
 * ```
 */
export class InvalidSystemUserOperationException extends Error {
  constructor(message = 'This operation cannot be performed by the system user') {
    super(message);
    this.name = 'InvalidSystemUserOperationException';
    Error.captureStackTrace(this, this.constructor);
  }
}
