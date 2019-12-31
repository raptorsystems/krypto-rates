/* eslint-disable @typescript-eslint/camelcase */
import { AxiosInstance } from 'axios'
import moment from 'moment'
import { RateSource } from '../models'
import { Currency, ParsedRate, ParsedRates, Timeframe } from '../types'
import { chunkDateRange, parseMarket } from '../utils'
import { createClient } from './client'

export class CurrencylayerSource implements RateSource {
  public static id = 'currencylayer.com'

  public get client(): AxiosInstance {
    const client = createClient(CurrencylayerSource.id, {
      baseURL: 'https://apilayer.net/api/',
      timeout: 10000,
    })
    client.interceptors.request.use(config => ({
      ...config,
      params: {
        access_key: process.env.CURRENCYLAYER_ACCESS_KEY,
        ...config.params,
      },
    }))
    return client
  }

  public async fetchLive(
    base: Currency,
    currencies: Currency[],
  ): Promise<ParsedRates> {
    const {
      data: { quotes = {}, timestamp },
    } = await this.client.get<CurrencylayerLive>('live', {
      params: {
        source: base,
        currencies: currencies.join(','),
      },
    })
    return Object.entries(quotes).map(([market, value]) =>
      this.parseRate(market, base, timestamp * 1000, value),
    )
  }

  public async fetchHistorical(
    base: Currency,
    currencies: Currency[],
    date: Date,
  ): Promise<ParsedRates> {
    const {
      data: { quotes = {} },
    } = await this.client.get<CurrencylayerHistorical>('historical', {
      params: {
        source: base,
        currencies: currencies.join(','),
        date: date.toISOString().slice(0, 10),
      },
    })
    return Object.entries(quotes).map(([market, value]) =>
      this.parseRate(market, base, date, value),
    )
  }

  public async fetchTimeframe(
    base: Currency,
    currencies: Currency[],
    timeframe: Timeframe<Date>,
  ): Promise<ParsedRates> {
    const fetch = async (start: Date, end: Date): Promise<ParsedRates> => {
      const {
        data: { quotes = {} },
      } = await this.client.get<CurrencylayerTimeframe>('timeframe', {
        params: {
          source: base,
          currencies: currencies.join(','),
          start_date: start.toISOString().slice(0, 10),
          end_date: end.toISOString().slice(0, 10),
        },
      })
      const result = Object.entries(quotes).flatMap(([date, rates]) =>
        Object.entries(rates).map(([market, value]) =>
          this.parseRate(market, base, date, value),
        ),
      )
      return result
    }
    // currencylayer timeframe endpoint maximum range is 365 days
    const MAX_RANGE = 365

    const result = await Promise.all(
      chunkDateRange(timeframe, MAX_RANGE).map(range =>
        fetch(range[0], range[range.length - 1]),
      ),
    )
    return result.flat()
  }

  private parseRate(
    marketCode: string,
    base: Currency,
    timestamp: string | number | Date,
    value: number,
  ): ParsedRate {
    const { market, inverse } = parseMarket(marketCode, base)
    return {
      source: CurrencylayerSource.id,
      sourceData: { [market.code]: value },
      market,
      timestamp: moment.utc(timestamp).toDate(),
      value,
      inverse,
    }
  }
}

interface CurrencylayerError {
  code: number
  type: string
  info?: string
}

type CurrencylayerRates = { [market: string]: number }

interface CurrencylayerLive {
  success: boolean
  terms: string
  privacy: string
  timestamp: number
  source: string
  quotes: CurrencylayerRates
  error?: CurrencylayerError
}

interface CurrencylayerHistorical {
  success: boolean
  terms: string
  privacy: string
  historical: boolean
  date: string
  timestamp: number
  source: string
  quotes: CurrencylayerRates
  error?: CurrencylayerError
}

interface CurrencylayerTimeframe {
  success: boolean
  terms: string
  privacy: string
  timeframe: boolean
  start_date: string
  end_date: string
  source: string
  quotes: { [date: string]: CurrencylayerRates }
  error?: CurrencylayerError
}
