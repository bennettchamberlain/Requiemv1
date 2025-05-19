import { HookContext as FeathersHookContext, NextFunction } from '@feathersjs/feathers';
import { Application as FeathersApplication } from '@feathersjs/koa';
import { Type, defaultAppConfiguration } from '@feathersjs/typebox';
import type { Static } from '@feathersjs/typebox';

import { UserService } from '../services/user';

export const configurationSchema = Type.Intersect([
  defaultAppConfiguration,
  Type.Object({
    host: Type.String(),
    port: Type.Number(),
    public: Type.String(),
  }),
]);

export type ApplicationConfiguration = Static<typeof configurationSchema>;

export type { NextFunction };

// The types for app.get(name) and app.set(name)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Configuration extends ApplicationConfiguration {}

// A mapping of service names to types. Will be extended in service files.
export interface ServiceTypes {
  user: UserService;
}

// The application instance type that will be used everywhere else
export type Application = FeathersApplication<ServiceTypes, Configuration>;

// The context for hook functions - can be typed with a service class
export type HookContext<S = unknown> = FeathersHookContext<Application, S>;
