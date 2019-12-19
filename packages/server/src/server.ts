import { dotenv } from '@raptorsystems/krypto-rates-utils/dotenv'
dotenv.config()

import { ApolloServer } from 'apollo-server'
import chalk from 'chalk'
import { createContext } from './context'
import { schema } from './schema'

new ApolloServer({
  schema,
  context: createContext,
  playground: true,
  introspection: true,
})
  .listen({ port: process.env.PORT || 4000 })
  .then(({ url }) => console.log(`Server ready at ${chalk.cyan(url)}`))
