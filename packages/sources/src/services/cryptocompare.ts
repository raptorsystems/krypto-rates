import { Market } from '@raptorsystems/krypto-rates-common/src/market'
import {
  Currency,
  MarketInput,
  ParsedRate,
  Timeframe,
} from '@raptorsystems/krypto-rates-common/src/types'
import { chunkDateRange } from '@raptorsystems/krypto-rates-utils/src/index'
import { AxiosInstance } from 'axios'
import { fromUnixTime, getUnixTime } from 'date-fns'
import { JsonValue } from 'type-fest'
import {
  createClient,
  mapMarketsByBase,
  RateSourceError,
  unixTime,
} from '../utils'
import { RatesSource } from './types'

const fetchMarkets = async <T>(
  markets: MarketInput[],
  fetch: (base: string, currencies: string[]) => Promise<T[]>,
): Promise<T[]> =>
  mapMarketsByBase(markets, (quote, markets) =>
    fetch(
      quote,
      markets.map((m) => m.quote),
    ),
  )

export class CryptoCompareSource implements RatesSource {
  public static id = 'cryptocompare.com'

  public get client(): AxiosInstance {
    const client = createClient(CryptoCompareSource.id, {
      baseURL: 'https://min-api.cryptocompare.com/data',
      timeout: 10000,
    })
    client.interceptors.request.use((config) => ({
      ...config,
      headers: {
        Apikey: process.env.CRYPTOCOMPARE_API_KEY,
        ...config.headers,
      },
      params: {
        extraParams: 'krypto-rates',
        ...config.params,
      },
    }))
    return client
  }

  public async fetchLive(markets: MarketInput[]): Promise<ParsedRate[]> {
    const timestamp = unixTime()

    const parse = (data: PriceMultiResponse): ParsedRate[] =>
      markets.map(({ base, quote }) => {
        const value = data[base]?.[quote] ?? null
        const source = { [base]: { [quote]: value } }
        return this.parseRate(base, quote, timestamp, timestamp, value, source)
      })

    const fetch = async (
      fsyms: string[],
      tsyms: string[],
    ): Promise<ParsedRate[]> => {
      const { data } = await this.client.get<PriceMultiResponse>('pricemulti', {
        params: { fsyms: fsyms.join(','), tsyms: tsyms.join(',') },
      })
      if ('Response' in data) {
        throw new RateSourceError((data.Message as unknown) as string, data)
      }
      return parse(data)
    }

    return fetchMarkets(markets, (base, quotes) => fetch([base], quotes))
  }

  public async fetchHistorical(
    markets: MarketInput[],
    date: Date,
  ): Promise<ParsedRate[]> {
    const timestamp = getUnixTime(date)

    const parse = (data: PriceHistoricalResponse): ParsedRate[] =>
      markets.map(({ base, quote }) => {
        const value = data[base]?.[quote] ?? null
        const source = { [base]: { [quote]: value } }
        return this.parseRate(base, quote, timestamp, timestamp, value, source)
      })

    const fetch = async (
      fsym: string,
      tsyms: string[],
    ): Promise<ParsedRate[]> => {
      const { data } = await this.client.get<PriceHistoricalResponse>(
        'pricehistorical',
        { params: { fsym, tsyms: tsyms.join(','), ts: timestamp } },
      )
      if ('Response' in data) {
        throw new RateSourceError((data.Message as unknown) as string, data)
      }
      return parse(data)
    }

    return fetchMarkets(markets, (base, quotes) => fetch(base, quotes))
  }

  public async fetchTimeframe(
    markets: MarketInput[],
    timeframe: Timeframe<Date>,
  ): Promise<ParsedRate[]> {
    // cryptocompare maximum number of data points is 2000
    const MAX_LIMIT = 2000

    const parse = (
      data: HistoricalResponseData,
      base: Currency,
      quote: Currency,
    ): ParsedRate[] =>
      data.Data.flatMap((metrics) =>
        this.parseRate(
          base,
          quote,
          metrics.time,
          metrics.time,
          // TODO: Determine which data point from OHLC to use as value
          metrics.close,
          { ...metrics },
        ),
      )

    const fetch = async (
      fsym: string,
      tsym: string,
      toTs: Date,
      limit: number,
    ): Promise<ParsedRate[]> => {
      // ? limit returns n + 1 rates
      limit -= 1
      const { data } = await this.client.get<HistoricalResponse>('histoday', {
        params: { fsym, tsym, toTs: getUnixTime(toTs), limit },
      })
      if ('Response' in data && data.Response === 'Error') {
        throw new RateSourceError(data.Message, data)
      }
      if (data.Data.Data.length !== limit)
        throw new RateSourceError(
          'CryptoCompare `data/histoday` request returned wrong number of rates',
        )
      return parse(data.Data, fsym, tsym)
    }

    const rates = await Promise.all(
      chunkDateRange(timeframe, MAX_LIMIT).flatMap((range) =>
        markets.map(({ base, quote }) =>
          fetch(base, quote, range[range.length - 1], range.length),
        ),
      ),
    )
    return rates.flat()
  }

  private parseRate(
    base: Currency,
    quote: Currency,
    date: Date | number | string,
    timestamp: number,
    value: number | null,
    sourceData: JsonValue,
  ): ParsedRate {
    if (typeof date === 'number') date = fromUnixTime(date)
    if (typeof date === 'object') date = date.toISOString()
    if (typeof date === 'string') date = date.slice(0, 10)
    return {
      source: CryptoCompareSource.id,
      sourceData,
      market: new Market(base, quote),
      date,
      timestamp,
      value,
      inverse: false,
      bridged: false,
    }
  }
}

interface ErrorResponse {
  Response: 'Error'
  Message: string
  HasWarning: boolean
  RateLimit: Record<string, unknown>
  Data: Record<string, unknown>
  Warning?: string
  ParamWithError?: string
}

interface SuccessResponse<TData> {
  Response: 'Success'
  Message: string
  HasWarning: boolean
  Warning?: string
  Data: TData
}

interface PriceResponse {
  [tsymb: string]: number
}

interface PriceMultiResponse {
  [fsymb: string]: PriceResponse
}

type PriceHistoricalResponse = PriceMultiResponse

interface HistoricalMetrics {
  time: number
  open: number
  high: number
  low: number
  close: number
  volumefrom: number
  volumeto: number
}

interface HistoricalResponseData {
  Aggregated: boolean
  TimeFrom: number
  TimeTo: number
  Data: HistoricalMetrics[]
}

type Response<R> = R | ErrorResponse

type HistoricalSuccessResponse = SuccessResponse<HistoricalResponseData>

type HistoricalResponse = Response<HistoricalSuccessResponse>

export type CryptoCompareRates = PriceMultiResponse | HistoricalMetrics