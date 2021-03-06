import { Market } from '@raptorsystems/krypto-rates-common/src/market'
import {
  Currency,
  MarketInput,
  ParsedRate,
  Timeframe,
} from '@raptorsystems/krypto-rates-common/src/types'
import { chunkDateRange } from '@raptorsystems/krypto-rates-utils/src/index'
import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'
import Bottleneck from 'bottleneck'
import { fromUnixTime, getUnixTime } from 'date-fns'
import Redis from 'ioredis'
import { JsonValue } from 'type-fest'
import {
  commonCurrencies,
  createClient,
  mapMarketsByBase,
  RateSourceError,
  unixTime,
} from '../utils'
import { RatesSource } from './types'

const { fromSource, marketToSource } = commonCurrencies([
  { common: 'IOT', source: 'MIOTA' },
  { common: 'ONTGAS', source: 'ONGAS' },
])

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
  public client: AxiosInstance
  public limiter: Bottleneck

  public constructor() {
    const API_KEY = process.env.CRYPTOCOMPARE_API_KEY
    if (!API_KEY) throw new RateSourceError('Missing CRYPTOCOMPARE_API_KEY')

    // Init client
    this.client = createClient(CryptoCompareSource.id, {
      baseURL: 'https://min-api.cryptocompare.com/data',
      timeout: 10000,
    })
    this.client.interceptors.request.use((config) => ({
      ...config,
      headers: {
        Apikey: API_KEY,
        ...config.headers,
      },
      params: {
        extraParams: 'krypto-rates',
        ...config.params,
      },
    }))

    /** Init Bottleneck limiter
     * CryptoCompare rate limit on Free Plan:
     * second: 50 req -> 20ms
     * minute: 2500 req -> 24ms
     * hour: 25k req -> 144ms
     * day: 50k req -> 1.728ms
     * month: 100k req -> 25.920ms
     * ? New limits?
     * second: 20 req -> 50ms
     * minute: 300 req -> 200ms
     * hour: 3k req -> 1200ms
     * day: 10k req -> 8640ms
     * month: 75k req -> 34560ms
     */
    this.limiter = new Bottleneck.Group({
      id: CryptoCompareSource.id,
      minTime: 500,
      maxConcurrent: 20,
      reservoir: 20,
      reservoirRefreshAmount: 20,
      reservoirRefreshInterval: 5000, // value should be a multiple of 250 (5000 for Clustering)
      // Clustering options
      datastore: 'ioredis',
      clientOptions: process.env.REDIS_URL,
      Redis,
    }).key(API_KEY)
  }

  protected throttledGet<T>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse<T>> {
    return this.limiter.schedule({ expiration: 10000 }, () =>
      this.client.get<T>(url, config),
    )
  }

  public async fetchLive(markets: MarketInput[]): Promise<ParsedRate[]> {
    const timestamp = unixTime()

    markets = markets.map(marketToSource)

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
      const { data } = await this.throttledGet<PriceMultiResponse>(
        'pricemulti',
        { params: { fsyms: fsyms.join(','), tsyms: tsyms.join(',') } },
      )
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

    markets = markets.map(marketToSource)

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
      const { data } = await this.throttledGet<PriceHistoricalResponse>(
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

    markets = markets.map(marketToSource)

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
      const { data } = await this.throttledGet<HistoricalResponse>(
        'v2/histoday',
        // ? limit returns n + 1 rates
        { params: { fsym, tsym, toTs: getUnixTime(toTs), limit: limit - 1 } },
      )
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

  protected parseRate(
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
      market: new Market(fromSource(base), fromSource(quote)),
      date,
      timestamp,
      value,
      inverse: false,
      bridged: false,
    }
  }
}

export interface ErrorResponse {
  Response: 'Error'
  Message: string
  HasWarning: boolean
  RateLimit: Record<string, unknown>
  Data: Record<string, unknown>
  Warning?: string
  ParamWithError?: string
}

export interface SuccessResponse<TData> {
  Response: 'Success'
  Message: string
  HasWarning: boolean
  Warning?: string
  Data: TData
}

export interface PriceResponse {
  [tsymb: string]: number
}

export interface PriceMultiResponse {
  [fsymb: string]: PriceResponse
}

export type PriceHistoricalResponse = PriceMultiResponse

export interface HistoricalMetrics {
  time: number
  open: number
  high: number
  low: number
  close: number
  volumefrom: number
  volumeto: number
}

export interface HistoricalResponseData {
  Aggregated: boolean
  TimeFrom: number
  TimeTo: number
  Data: HistoricalMetrics[]
}

type Response<R> = R | ErrorResponse

export type HistoricalSuccessResponse = SuccessResponse<HistoricalResponseData>

export type HistoricalResponse = Response<HistoricalSuccessResponse>

export type CryptoCompareRates = PriceMultiResponse | HistoricalMetrics
