import * as types from '@raptorsystems/krypto-rates-common/src/types'
import { CoinlayerSource } from './services/coinlayer'
import { CryptoCompareSource } from './services/cryptocompare'
import { CurrencylayerSource } from './services/currencylayer'
import { NomicsSource } from './services/nomics'
import { SBIFSource } from './services/sbif'

export type RateSources =
  | CoinlayerSource
  | CurrencylayerSource
  | CryptoCompareSource
  | NomicsSource
  | SBIFSource

export type Rate = types.Rate
export type DbRate = types.DbRate
export type ParsedRate = types.ParsedRate
export type NullableDbRate = types.NullableDbRate

export interface CommonCurrency {
  common: types.Currency
  source: types.Currency
}
