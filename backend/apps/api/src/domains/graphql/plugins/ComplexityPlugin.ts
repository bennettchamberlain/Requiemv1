import { ApolloServerPlugin, type BaseContext, type GraphQLRequestListener } from '@apollo/server';
import { Plugin } from '@nestjs/apollo';
import { HttpStatus } from '@nestjs/common';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import { fieldExtensionsEstimator, getComplexity, simpleEstimator } from 'graphql-query-complexity';

import { LoggerService } from '@ci/common/services';

@Plugin()
export class ComplexityPlugin implements ApolloServerPlugin {
  private readonly logger = new LoggerService(ComplexityPlugin.name);

  constructor(private readonly gqlSchemaHost: GraphQLSchemaHost) {}

  async requestDidStart(): Promise<GraphQLRequestListener<BaseContext>> {
    const { schema } = this.gqlSchemaHost;

    const logger = this.logger;

    return {
      async didResolveOperation({ request, document }) {
        const maxComplexity = 20;

        const complexity = getComplexity({
          schema,
          operationName: request.operationName,
          query: document,
          variables: request.variables,
          estimators: [
            // Checks if a specific field has a custom complexity defined
            fieldExtensionsEstimator(),

            // Fallback to assigning a value of 1 to every field
            simpleEstimator({
              defaultComplexity: 1,
            }),
          ],
        });

        if (complexity > maxComplexity) {
          throw new GraphQLError(
            `Query is too complex: ${complexity}. Maximum allowed complexity: ${maxComplexity}`,
            {
              extensions: {
                code: 'BAD_REQUEST',
                http: {
                  status: HttpStatus.BAD_REQUEST,
                },
              },
            },
          );
        }

        logger.log('GraphQL complexity logged', {
          complexity,
        });
      },
    };
  }
}
