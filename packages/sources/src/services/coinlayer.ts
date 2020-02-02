/* eslint-disable @typescript-eslint/camelcase */
import {
  Currency,
  ParsedRate,
  ParsedRates,
  Timeframe,
} from '@raptorsystems/krypto-rates-common/types'
import {
  chunkDateRange,
  generateDateRange,
  parseMarket,
} from '@raptorsystems/krypto-rates-utils'
import { AxiosInstance } from 'axios'
import moment from 'moment'
import { createClient, RateSourceError } from '../utils'
import { RatesSource } from './types'

export class CoinlayerSource implements RatesSource<CoinlayerRates> {
  public static id = 'coinlayer.com'

  public get client(): AxiosInstance {
    const client = createClient(CoinlayerSource.id, {
      baseURL: 'http://api.coinlayer.com/',
      timeout: 10000,
    })
    client.interceptors.request.use(config => ({
      ...config,
      params: {
        access_key: process.env.COINLAYER_ACCESS_KEY,
        ...config.params,
      },
    }))
    return client
  }

  private handleError({ error }: CoinlayerResponse): void {
    if (error) throw new RateSourceError(error.info, error)
  }

  public async fetchLive(
    base: Currency,
    currencies: Currency[],
  ): Promise<ParsedRates<CoinlayerRates>> {
    const parse = (
      data: CoinlayerLive,
      quote: Currency,
    ): ParsedRates<CoinlayerRates> =>
      Object.entries(data.rates).map(([symbol, value]) =>
        this.parseRate(
          symbol + quote,
          base,
          data.timestamp,
          data.timestamp,
          value,
        ),
      )

    const fetch = async (
      target: string,
      symbols: string[],
    ): Promise<ParsedRates<CoinlayerRates>> => {
      const { data } = await this.client.get<CoinlayerLive>('live', {
        params: { target, symbols: symbols.join(',') },
      })
      this.handleError(data)
      return parse(data, target)
    }

    const rates = await Promise.all(
      currencies.map(quote => fetch(quote, [base])),
    )
    return rates.flat()
  }

  public async fetchHistorical(
    base: Currency,
    currencies: Currency[],
    date: Date,
  ): Promise<ParsedRates<CoinlayerRates>> {
    const parse = (
      data: CoinlayerHistorical,
      quote: Currency,
    ): ParsedRates<CoinlayerRates> =>
      Object.entries(data.rates).map(([symbol, value]) =>
        this.parseRate(
          symbol + quote,
          base,
          date.toISOString(),
          data.timestamp,
          value,
        ),
      )

    const fetch = async (
      target: string,
      symbols: string[],
    ): Promise<ParsedRates<CoinlayerRates>> => {
      const { data } = await this.client.get<CoinlayerHistorical>(
        date.toISOString().slice(0, 10),
        { params: { target, symbols: symbols.join(',') } },
      )
      this.handleError(data)
      return parse(data, target)
    }

    const rates = await Promise.all(
      currencies.map(quote => fetch(quote, [base])),
    )
    return rates.flat()
  }

  public async fetchTimeframe(
    base: Currency,
    currencies: Currency[],
    timeframe: Timeframe<Date>,
  ): Promise<ParsedRates<CoinlayerRates>> {
    const parse = (
      data: CoinlayerTimeframe,
      quote: Currency,
    ): ParsedRates<CoinlayerRates> =>
      Object.entries(data.rates).flatMap(([date, rates]) =>
        Object.entries(rates).map(([symbol, value]) =>
          this.parseRate(symbol + quote, base, date, date, value),
        ),
      )

    const fetch = async (
      target: string,
      symbols: string[],
      start: Date,
      end: Date,
    ): Promise<ParsedRates<CoinlayerRates>> => {
      const { data } = await this.client.get<CoinlayerTimeframe>('timeframe', {
        params: {
          target,
          symbols: symbols.join(','),
          start_date: start.toISOString().slice(0, 10),
          end_date: end.toISOString().slice(0, 10),
        },
      })
      this.handleError(data)
      return parse(data, target)
    }

    // coinlayer timeframe endpoint maximum range is 365 days
    const MAX_RANGE = 365

    const fetchAll = async (
      target: string,
      symbols: string[],
    ): Promise<ParsedRates<CoinlayerRates>> => {
      const result = await Promise.all(
        chunkDateRange(timeframe, MAX_RANGE).map(range =>
          fetch(target, symbols, range[0], range[range.length - 1]),
        ),
      )
      return result.flat()
    }

    const rates =
      process.env.COINLAYER_TIMEFRAME === 'true'
        ? await Promise.all(currencies.map(quote => fetchAll(quote, [base])))
        : await Promise.all(
            generateDateRange(timeframe).map(date =>
              this.fetchHistorical(base, currencies, date),
            ),
          )
    return rates.flat()
  }

  private parseRate(
    marketCode: string,
    base: Currency,
    date: number | string,
    timestamp: number | string,
    value: number,
  ): ParsedRate<CoinlayerRates> {
    const { market, inverse } = parseMarket(marketCode, base)
    if (typeof date === 'number') {
      date = moment.unix(date).toISOString()
    }
    if (typeof date === 'string') {
      date = date.slice(0, 10)
    }
    if (typeof timestamp === 'string') {
      timestamp = moment.utc(timestamp).unix()
    }
    return {
      source: CoinlayerSource.id,
      sourceData: { [market.code]: value },
      market,
      date,
      timestamp,
      value,
      inverse,
    }
  }
}

export type CoinlayerRates = { [symbol: string]: number }

interface CoinlayerError {
  code: number
  type: string
  info: string
}

interface CoinlayerResponse {
  success: boolean
  terms: string
  privacy: string
  target: string
  error?: CoinlayerError
}

interface CoinlayerLive extends CoinlayerResponse {
  timestamp: number
  rates: CoinlayerRates
}

interface CoinlayerHistorical extends CoinlayerResponse {
  historical: boolean
  date: string
  timestamp: number
  rates: CoinlayerRates
}

interface CoinlayerTimeframe extends CoinlayerResponse {
  timeframe: boolean
  start_date: string
  end_date: string
  rates: { [date: string]: CoinlayerRates }
}
