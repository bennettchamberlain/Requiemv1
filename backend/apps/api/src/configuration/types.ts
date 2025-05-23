import { HookContext as FeathersHookContext, NextFunction } from '@feathersjs/feathers';
import { Application as FeathersApplication } from '@feathersjs/koa';
import { Type, defaultAppConfiguration } from '@feathersjs/typebox';
import type { Static } from '@feathersjs/typebox';
import type { Knex } from 'knex';

import type { ServiceTypes } from '../services';

export const configurationSchema = Type.Object({
  ...defaultAppConfiguration.properties,
  host: Type.String(),
  port: Type.Number(),
  authentication: Type.Object({
    secret: Type.String(),
    authStrategies: Type.Array(Type.String()),
    service: Type.String(),
    entity: Type.String(),
    jwtOptions: Type.Object({
      header: Type.Object({
        typ: Type.String(),
      }),
      expiresIn: Type.String(),
      algorithm: Type.String(),
      audience: Type.String(),
      issuer: Type.String(),
    }),
    local: Type.Object({
      usernameField: Type.String(),
      passwordField: Type.String(),
    }),
  }),
});

export type ApplicationConfiguration = Static<typeof configurationSchema>;

// The types for app.get(name) and app.set(name)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Configuration extends ApplicationConfiguration {
  postgresqlClient: Knex;
}

// The application instance type that will be used everywhere else
export type Application = FeathersApplication<ServiceTypes, Configuration>;

// The context for hook functions - can be typed with a service class
export type HookContext<S = unknown> = FeathersHookContext<Application, S>;

export type { NextFunction };
