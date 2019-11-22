export * from '@krypto-rates/common/utils'
import {
  Rate as PrismaRate,
  RateCreateInput as PrismaRateCreateInput,
} from '@generated/photon'
import {
  Currency,
  Rate,
  Timeframe,
  ParsedRate,
} from '@krypto-rates/common/types'
import { parseMarket } from '@krypto-rates/common/utils'
import * as Moment from 'moment'
import { extendMoment } from 'moment-range'
import { Market } from '@krypto-rates/common/market'

const moment = Moment.default

export function generateDateRange({ start, end }: Timeframe): Date[] {
  const moment = extendMoment(Moment)
  return Array.from(
    moment.range(moment.utc(start), moment.utc(end)).by('day'),
    el => el.toDate(),
  )
}

export function consecutiveDateGroups(iterable: Date[]): Date[][] {
  return iterable.reduce<Date[][]>(
    (groups, date) => {
      const lastGroup = groups[groups.length - 1]
      if (
        // difference in days is greater than 1
        moment(date).diff(
          moment(lastGroup[lastGroup.length - 1] || date),
          'days',
        ) > 1
      ) {
        // add new group
        groups.push([date])
      } else {
        // add date to last group
        lastGroup.push(date)
      }
      return groups
    },
    [[]],
  )
}

export function consecutiveTimeframes(iterable: Date[]): Timeframe<Date>[] {
  return consecutiveDateGroups(iterable).map(group => ({
    start: group[0],
    end: group[group.length - 1],
  }))
}

export function dailyFilter({ timestamp }: { timestamp: Date }): boolean {
  const date = moment(timestamp)
  return date.isSame(date.startOf('day'))
}

export function parseRate(base: Currency, rate: PrismaRate): Rate<Market> {
  let { value } = rate
  const {
    timestamp,
    source,
    // sourceData,
    market,
  } = rate
  const { market: parsedMarket, inverse } = parseMarket(market, base)
  if (inverse) value **= -1
  return {
    timestamp,
    value,
    source,
    // sourceData,
    market: parsedMarket,
    inverse,
  }
}

export const parsePrismaRate = ({
  timestamp,
  value,
  source,
  // sourceData,
  market,
  inverse,
}: ParsedRate): PrismaRateCreateInput => {
  if (inverse) {
    market = market.inverse
    value **= -1
  }
  return {
    timestamp,
    value,
    source,
    // sourceData,
    market: market.id,
  }
}

export function logCreate(data: PrismaRate): void {
  console.log(`Rate created on Prisma\n${JSON.stringify(data, undefined, 2)}`)
}

export function logFetch(data: Rate): void {
  console.log(`Rate fetched\n${JSON.stringify(data, undefined, 2)}`)
}
