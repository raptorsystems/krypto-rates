import { formatApolloErrors, fromGraphQLError } from 'apollo-server-errors'
import { ExecutionResult } from 'graphql'
import { processRequest as _processRequest } from 'graphql-helix'
import {
  ProcessRequestOptions,
  ProcessRequestResult,
} from 'graphql-helix/dist/types'
import { Context, createContext } from './context'
import { schema } from './schema'

const isDev = process.env.NODE_ENV === 'development'

export const processRequest = <TRootValue = unknown>(
  options: Omit<
    ProcessRequestOptions<Context, TRootValue>,
    'schema' | 'contextFactory'
  >,
): Promise<ProcessRequestResult<Context, TRootValue>> =>
  _processRequest({
    ...options,
    schema,
    contextFactory: createContext,
  })

export const formatResult = ({
  errors,
  ...result
}: ExecutionResult): ExecutionResult => ({
  ...result,
  errors:
    errors &&
    formatApolloErrors(
      errors?.map((error) => fromGraphQLError(error)),
      {
        debug: isDev,
        formatter: (error) => {
          console.error(error.originalError)
          return error
        },
      },
    ),
})
