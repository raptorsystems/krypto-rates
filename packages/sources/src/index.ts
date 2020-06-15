import { Market } from '@raptorsystems/krypto-rates-common/src/market'
import {
  Currency,
  MarketInput,
  ParsedRate,
  Timeframe,
} from '@raptorsystems/krypto-rates-common/src/types'
import { parseMarket } from '@raptorsystems/krypto-rates-utils/src/index'
import { CoinlayerSource } from './services/coinlayer'
import { CryptoCompareSource } from './services/cryptocompare'
import { CurrencylayerSource } from './services/currencylayer'
import { MarketsByKey, RatesSource as BaseRateSource } from './services/types'
import { RateSources } from './types'
import { buildMarketsByKey, mapMarketsByBase } from './utils'

export const rateSourceById = {
  [CoinlayerSource.id]: CoinlayerSource,
  [CurrencylayerSource.id]: CurrencylayerSource,
  [CryptoCompareSource.id]: CryptoCompareSource,
}

export class RatesSource implements BaseRateSource {
  public constructor(
    public getSourceId: (market: string) => Promise<string | null | undefined>,
    public hasCurrency: (currency: string) => Promise<boolean>,
  ) {}

  public async fetchLive(markets: MarketInput[]): Promise<ParsedRate[]> {
    return this.fetchForMarkets(markets, (source, markets) =>
      source.fetchLive(markets),
    )
  }

  public async fetchHistorical(
    markets: MarketInput[],
    date: Date,
  ): Promise<ParsedRate[]> {
    return this.fetchForMarkets(markets, (source, markets) =>
      source.fetchHistorical(markets, date),
    )
  }

  public async fetchTimeframe(
    markets: MarketInput[],
    timeframe: Timeframe<Date>,
  ): Promise<ParsedRate[]> {
    return this.fetchForMarkets(markets, (source, markets) =>
      source.fetchTimeframe(markets, timeframe),
    )
  }

  public setSource(sourceId: string): RateSources {
    const source = rateSourceById[sourceId]
    if (!source) throw `RateSource '${sourceId}' is not supported`
    return new source()
  }

  private async getSource(market: Market): Promise<RateSources | undefined> {
    const sourceId = await this.getSourceId(market.id)
    if (sourceId) {
      const source = rateSourceById[sourceId]
      if (source) return new source()
    }
  }

  private async validateCurrency(currency: string): Promise<void> {
    if (!(await this.hasCurrency(currency)))
      throw `Currency '${currency}' is not supported`
  }

  private async validateMarkets(markets: MarketInput[]): Promise<void> {
    await Promise.all(
      markets.map(async ({ base, quote }) => {
        await Promise.all([
          this.validateCurrency(base),
          this.validateCurrency(quote),
        ])
      }),
    )
  }

  private buildResponse(base: Currency, rates: ParsedRate[]): ParsedRate[] {
    return rates.map((rate) => {
      const { market: parsedMarket, inverse } = parseMarket(rate.market, base)
      if (inverse) {
        rate.market = parsedMarket
        if (rate.value) rate.value **= -1
      }
      return rate
    })
  }

  private async buildMarketsBySource(
    markets: Market[],
  ): Promise<MarketsByKey<RateSources, Market>> {
    return buildMarketsByKey<RateSources>(markets, (market) =>
      this.getSource(market),
    )
  }

  private async fetchForMarkets(
    markets: MarketInput[],
    fetch: (
      source: RateSources,
      markets: MarketInput[],
    ) => Promise<ParsedRate[]>,
  ): Promise<ParsedRate[]> {
    // Validate markets
    await this.validateMarkets(markets)
    // Map markets
    return mapMarketsByBase(
      markets.map(({ base, quote }) => new Market(base, quote)),
      async (base, markets) => {
        const marketsBySource = await this.buildMarketsBySource(markets)
        const rates = await Promise.all(
          Array.from(marketsBySource).flatMap(async ([source, markets]) => {
            const sourceRates = await fetch(source, markets)
            return this.buildResponse(base, sourceRates)
          }),
        )
        return rates.flat()
      },
    )
  }
}
