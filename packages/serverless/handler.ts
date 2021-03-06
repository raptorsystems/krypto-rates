import { dotenv } from '@raptorsystems/krypto-rates-utils/src/dotenv'
dotenv.config()

import {
  formatResult,
  processRequest,
} from '@raptorsystems/krypto-rates-core/src/graphql-helix'
import type { APIGatewayProxyHandler } from 'aws-lambda'
import { getGraphQLParameters } from 'graphql-helix'
import { Request } from 'graphql-helix/dist/types'
import { renderPlaygroundPage } from 'graphql-playground-html'

export const graphql: APIGatewayProxyHandler = async (event) => {
  const request: Request = {
    body: event.body && JSON.parse(event.body),
    headers: event.headers,
    method: event.httpMethod,
    query: event.queryStringParameters,
  }

  if (request.method === 'GET') {
    return {
      statusCode: 200,
      body: renderPlaygroundPage({ endpoint: event.requestContext.path }),
      headers: {
        'Content-Type': 'text/html',
      },
    }
  }

  const { operationName, query, variables } = getGraphQLParameters(request)

  const result = await processRequest({
    operationName,
    query,
    variables,
    request,
  })

  if (result.type === 'RESPONSE') {
    return {
      statusCode: result.status,
      body: JSON.stringify(formatResult(result.payload)),
      headers: result.headers.reduce(
        (obj, { name, value }) => ({ ...obj, [name]: value }),
        {},
      ),
    }
  } else {
    throw new Error(`Unsupported graphql-helix result type: ${result.type}}`)
  }
}
