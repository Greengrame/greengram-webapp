import type { LangFn } from './localization';

import { TON_CURRENCY_CODE } from '../config';
import { formatTonAsIcon } from './localization/format';

const NANOS_PER_COIN = 1e9;

// Greengram: the server sends every coin at 9 decimals in a wallet transfer's crypto_amount
export function formatWalletTransferAmount(lang: LangFn, nanos?: bigint, code?: string) {
  if (!nanos) return '';
  if (!code || code === TON_CURRENCY_CODE) return formatTonAsIcon(lang, nanos);

  return `${lang.number(Number(nanos) / NANOS_PER_COIN)} ${code}`;
}
