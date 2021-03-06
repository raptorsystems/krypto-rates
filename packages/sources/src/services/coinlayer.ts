import {
  Currency,
  MarketInput,
  ParsedRate,
  Timeframe,
} from '@raptorsystems/krypto-rates-common/src/types'
import {
  chunkDateRange,
  generateDateRange,
  parseMarket,
} from '@raptorsystems/krypto-rates-utils/src/index'
import { AxiosInstance } from 'axios'
import { fromUnixTime, getUnixTime, parseISO } from 'date-fns'
import {
  createClient,
  mapMarketsByQuote,
  RateSourceError,
  unixTime,
} from '../utils'
import { RatesSource } from './types'

const fetchMarkets = async <T>(
  markets: MarketInput[],
  fetch: (quote: string, currencies: string[]) => Promise<T[]>,
): Promise<T[]> =>
  mapMarketsByQuote(markets, (quote, markets) =>
    fetch(
      quote,
      markets.map((m) => m.base),
    ),
  )

export class CoinlayerSource implements RatesSource {
  public static id = 'coinlayer.com'
  public client: AxiosInstance

  public constructor() {
    const ACCESS_KEY = process.env.COINLAYER_ACCESS_KEY
    if (!ACCESS_KEY) throw new RateSourceError('Missing COINLAYER_ACCESS_KEY')

    // Init client
    this.client = createClient(CoinlayerSource.id, {
      baseURL: 'http://api.coinlayer.com/',
      timeout: 10000,
    })
    this.client.interceptors.request.use((config) => ({
      ...config,
      params: {
        access_key: ACCESS_KEY,
        ...config.params,
      },
    }))
  }

  protected validateData<T extends CoinlayerResponseBase>(
    data: CoinlayerResponse<T>,
    fallbackData: T,
  ): T {
    if ('error' in data) {
      // code 106 `no_rates_available` The current request did not return any results
      if (data.error.code === 106) return fallbackData
      throw new RateSourceError(data.error.info, data.error)
    } else {
      return data
    }
  }

  public async fetchLive(markets: MarketInput[]): Promise<ParsedRate[]> {
    const parse = (data: CoinlayerLive, quote: Currency): ParsedRate[] =>
      Object.entries(data.rates).map(([symbol, value]) =>
        this.parseRate(
          symbol + quote,
          symbol,
          data.timestamp,
          data.timestamp,
          value,
        ),
      )

    const fetch = async (
      target: string,
      symbols: string[],
    ): Promise<ParsedRate[]> => {
      const { data } = await this.client.get<CoinlayerLiveResponse>('live', {
        params: { target, symbols: symbols.join(',') },
      })
      const validData = this.validateData(data, {
        success: false,
        target,
        timestamp: unixTime(),
        rates: this.buildNullRates(symbols),
      })
      return parse(validData, target)
    }

    return fetchMarkets(markets, (quote, currencies) =>
      fetch(quote, currencies),
    )
  }

  public async fetchHistorical(
    markets: MarketInput[],
    date: Date,
  ): Promise<ParsedRate[]> {
    const parse = (data: CoinlayerHistorical, quote: Currency): ParsedRate[] =>
      Object.entries(data.rates).map(([symbol, value]) =>
        this.parseRate(
          symbol + quote,
          symbol,
          date.toISOString(),
          data.timestamp,
          value,
        ),
      )

    const fetch = async (
      target: string,
      symbols: string[],
    ): Promise<ParsedRate[]> => {
      const { data } = await this.client.get<CoinlayerHistoricalResponse>(
        date.toISOString().slice(0, 10),
        { params: { target, symbols: symbols.join(',') } },
      )
      const validData = this.validateData(data, {
        success: false,
        historical: true,
        date: date.toISOString().slice(0, 10),
        target,
        timestamp: unixTime(),
        rates: this.buildNullRates(symbols),
      })
      return parse(validData, target)
    }

    return fetchMarkets(markets, (quote, currencies) =>
      fetch(quote, currencies),
    )
  }

  public async fetchTimeframe(
    markets: MarketInput[],
    timeframe: Timeframe<Date>,
  ): Promise<ParsedRate[]> {
    const parse = (data: CoinlayerTimeframe, quote: Currency): ParsedRate[] =>
      Object.entries(data.rates).flatMap(([date, rates]) =>
        Object.entries(rates).map(([symbol, value]) =>
          this.parseRate(symbol + quote, symbol, date, date, value),
        ),
      )

    const fetch = async (
      target: string,
      symbols: string[],
      start: Date,
      end: Date,
    ): Promise<ParsedRate[]> => {
      const { data } = await this.client.get<CoinlayerTimeframeResponse>(
        'timeframe',
        {
          params: {
            target,
            symbols: symbols.join(','),
            start_date: start.toISOString().slice(0, 10),
            end_date: end.toISOString().slice(0, 10),
          },
        },
      )
      if ('error' in data) {
        // code 106 `no_rates_available` The current request did not return any results
        if (data.error.code === 106) {
          // fallback to fetch timeframe as historical dates
          const rates = await Promise.all(
            generateDateRange({ start, end }).map((date) =>
              this.fetchHistorical(markets, date),
            ),
          )
          return rates.flat()
        }
        throw new RateSourceError(data.error.info, data.error)
      }
      return parse(data, target)
    }

    // coinlayer timeframe endpoint maximum range is 365 days
    const MAX_RANGE = 365

    const rates =
      process.env.COINLAYER_TIMEFRAME === 'true'
        ? await Promise.all(
            chunkDateRange(timeframe, MAX_RANGE).map((range) =>
              fetchMarkets(markets, (base, currencies) =>
                fetch(base, currencies, range[0], range[range.length - 1]),
              ),
            ),
          )
        : await Promise.all(
            generateDateRange(timeframe).map((date) =>
              this.fetchHistorical(markets, date),
            ),
          )
    return rates.flat()
  }

  protected parseRate(
    marketCode: string,
    base: Currency,
    date: number | string,
    timestamp: number | string,
    value: number | null,
  ): ParsedRate {
    const { market, inverse } = parseMarket(marketCode, base)
    if (typeof date === 'number') {
      date = fromUnixTime(date).toISOString()
    }
    if (typeof date === 'string') {
      date = date.slice(0, 10)
    }
    if (typeof timestamp === 'string') {
      const parsedTimestamp = parseISO(`${timestamp}Z`) // add Z make it UTC eg. 2020-01-01Z
      timestamp = getUnixTime(parsedTimestamp)
    }
    return {
      source: CoinlayerSource.id,
      sourceData: { [market.code]: value },
      market,
      date,
      timestamp,
      value,
      inverse,
      bridged: false,
    }
  }

  protected buildNullRates = (symbols: string[]): CoinlayerRates =>
    symbols.reduce<CoinlayerRates>(
      (obj, symbol) => ({ ...obj, [symbol]: null }),
      {},
    )
}

export type CoinlayerRates = {
  // Rates from coinlayer are not nullable
  // use nullable rates to avoid 106 `no_rates_available` errors
  [symbol: string]: number | null
}

export interface CoinlayerError {
  code: number
  type: string
  info: string
}

export interface CoinlayerResponseBase {
  success: boolean
  terms?: string // prop is not optional but it's not useful
  privacy?: string // prop is not optional but it's not useful
  target: string
}

export interface CoinlayerErrorResponse {
  success: boolean
  error: CoinlayerError
}

export interface CoinlayerLive extends CoinlayerResponseBase {
  timestamp: number
  rates: CoinlayerRates
}

export interface CoinlayerHistorical extends CoinlayerResponseBase {
  historical: boolean
  date: string
  timestamp: number
  rates: CoinlayerRates
}

export interface CoinlayerTimeframe extends CoinlayerResponseBase {
  timeframe: boolean
  start_date: string
  end_date: string
  rates: { [date: string]: CoinlayerRates }
}

export type CoinlayerResponse<T = CoinlayerResponseBase> =
  | T
  | CoinlayerErrorResponse
export type CoinlayerLiveResponse = CoinlayerResponse<CoinlayerLive>
export type CoinlayerHistoricalResponse = CoinlayerResponse<CoinlayerHistorical>
export type CoinlayerTimeframeResponse = CoinlayerResponse<CoinlayerTimeframe>
