import { memo, useEffect, useMemo, useState } from '@teact';
import { getActions } from '../../../global';

import type { ApiStarTopupOption } from '../../../api/types';

import useLastCallback from '../../../hooks/useLastCallback';

import Island from '@gili/layout/Island';

import Button from '../../ui/Button';
import InputText from '../../ui/InputText';
import Select from '../../ui/Select';
import StarTopupOptionList from './StarTopupOptionList';

import styles from './WalletStarsPurchase.module.scss';


type Asset = {
  asset: string;
  name: string;
  balance: string;
  marketAvailable: boolean;
  starsPerCoin?: string;
  maxStars?: number;
};

type Quote = {
  quoteId: string;
  asset: string;
  amount: string;
  stars: number;
  expiresAt: number;
};

type OwnProps = {
  starsNeeded?: number;
  onDone: NoneToVoidFunction;
};

const MAX_CUSTOM_STARS = 1000000000;

const STAR_TIERS = [
  { stars: 50, isExtended: true },
  { stars: 100 },
  { stars: 150, isExtended: true },
  { stars: 250 },
  { stars: 350, isExtended: true },
  { stars: 500 },
  { stars: 750, isExtended: true },
  { stars: 1000 },
  { stars: 1500, isExtended: true },
  { stars: 2500 },
  { stars: 5000, isExtended: true },
  { stars: 10000, isExtended: true },
  { stars: 25000, isExtended: true },
];

const coinName = (code: string) => (code === 'TON' ? 'GRAM' : code);

async function callApi<T>(path: string, body?: object): Promise<T> {
  const slot = new URLSearchParams(self.location.search).get('account');
  const response = await fetch(`/api/stars/crypto/${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(slot && { 'X-Greengram-Account': slot }) },
    body: body && JSON.stringify(body),
  });
  const result = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(result?.error || 'Wallet is unavailable. Try again.');
  return result;
}

const WalletStarsPurchase = ({ starsNeeded, onDone }: OwnProps) => {
  const { loadStarStatus, openChatByUsername, closeStarsBalanceModal } = getActions();

  const [assets, setAssets] = useState<Asset[] | undefined>();
  const [code, setCode] = useState<string>('');
  const [quote, setQuote] = useState<Quote | undefined>();
  const [bought, setBought] = useState<number | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [customAmount, setCustomAmount] = useState('');

  const selected = assets?.find((item) => item.asset === code);
  const rate = Number(selected?.starsPerCoin);
  const customStars = Number(customAmount);
  const isCustomValid = /^\d+$/.test(customAmount) && Number.isSafeInteger(customStars)
    && customStars >= 1 && customStars <= MAX_CUSTOM_STARS;
  const canBuyCustom = isCustomValid && Boolean(selected?.marketAvailable)
    && (typeof selected?.maxStars !== 'number' || customStars <= selected.maxStars);
  const customPrice = isCustomValid && Number.isFinite(rate) && rate > 0
    ? `${(customStars / rate).toLocaleString(undefined, { maximumSignificantDigits: 6 })} ${coinName(code)}`
    : undefined;

  const options = useMemo(() => {
    const tiers: { stars: number; isExtended?: boolean }[] = [...STAR_TIERS];
    if (!selected?.marketAvailable || !rate) return [];
    if (starsNeeded && starsNeeded > 0 && !tiers.some((tier) => tier.stars === starsNeeded)) {
      tiers.push({ stars: starsNeeded });
      tiers.sort((a, b) => a.stars - b.stars);
    }
    return tiers
      .filter((tier) => selected.maxStars === undefined || tier.stars <= selected.maxStars)
      .map((tier) => ({ ...tier, amount: tier.stars / rate, currency: selected.asset }));
  }, [selected, rate, starsNeeded]) as ApiStarTopupOption[];

  const formatPrice = useLastCallback((option: { amount: number; currency: string }) => (
    `${option.amount.toLocaleString(undefined, { maximumSignificantDigits: 6 })} ${coinName(option.currency)}`
  ));

  const load = useLastCallback(async () => {
    let options: { assets: Asset[] };
    let list: Asset[];
    setIsBusy(true);
    setError(undefined);
    try {
      options = await callApi<{ assets: Asset[] }>('options');
      list = [...options.assets].sort((a, b) => Number(Number(b.balance) > 0) - Number(Number(a.balance) > 0));
      setAssets(list);
      setCode((current) => (list.some((item) => item.asset === current) ? current : list[0]?.asset || ''));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsBusy(false);
    }
  });

  useEffect(() => {
    load();
  }, [load]);

  const handleOption = useLastCallback(async (option: { stars: number }) => {
    if (isBusy || !selected) return;
    setIsBusy(true);
    setError(undefined);
    try {
      setQuote(await callApi<Quote>('quote', { asset: selected.asset, stars: option.stars }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsBusy(false);
    }
  });

  const handleCustomChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomAmount(e.currentTarget.value);
    setError(undefined);
  });

  const handleCustomBuy = useLastCallback(() => {
    if (isBusy || !canBuyCustom) return;
    handleOption({ stars: customStars });
  });

  const handleCustomKeyDown = useLastCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    handleCustomBuy();
  });

  const handleConfirm = useLastCallback(async () => {
    let result: { stars: number };
    if (isBusy || !quote) return;
    setIsBusy(true);
    setError(undefined);
    try {
      result = await callApi<{ stars: number }>('purchase', { quoteId: quote.quoteId });
      setBought(result.stars);
      setQuote(undefined);
      loadStarStatus();
    } catch (err) {
      setQuote(undefined);
      setError((err as Error).message);
    } finally {
      setIsBusy(false);
    }
  });

  const handleEdit = useLastCallback(() => {
    setQuote(undefined);
    setError(undefined);
  });

  const handleOpenWallet = useLastCallback(() => {
    closeStarsBalanceModal();
    openChatByUsername({ username: 'wallet', shouldStartMainApp: true });
  });

  if (bought !== undefined) {
    return (
      <div className={styles.root}>
        <p className={styles.result} role="status">{`${bought.toLocaleString()} Stars added.`}</p>
        <Button fluid onClick={onDone}>Done</Button>
      </div>
    );
  }

  if (quote) {
    return (
      <div className={styles.root}>
        <p className={styles.result} role="status">
          {`Pay ${quote.amount} ${coinName(quote.asset)} for ${quote.stars.toLocaleString()} Stars.`}
          <br />
          {`The price holds until ${new Date(quote.expiresAt * 1000).toLocaleTimeString()}.`}
        </p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <Button fluid isLoading={isBusy} disabled={isBusy} onClick={handleConfirm}>Confirm purchase</Button>
        <Button fluid isText noForcedUpperCase disabled={isBusy} onClick={handleEdit}>Back</Button>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {!assets && !error && <p className={styles.hint}>Loading Wallet balances and prices…</p>}
      {assets && (
        <>
          <Select
            id="wallet-stars-asset"
            label="Pay with Wallet"
            value={code}
            hasArrow
            onChange={(e) => {
              setCode(e.currentTarget.value);
              setError(undefined);
            }}
          >
            {assets.map((item) => (
              <option value={item.asset} key={item.asset}>
                {`${item.name} · ${item.balance} ${coinName(item.asset)}`}
              </option>
            ))}
          </Select>
          <InputText
            id="wallet-stars-custom-amount"
            label="Custom amount"
            inputMode="numeric"
            value={customAmount}
            disabled={isBusy}
            onChange={handleCustomChange}
            onKeyDown={handleCustomKeyDown}
          />
          {customAmount && !isCustomValid && (
            <p className={styles.hint}>Enter a whole number from 1 to 1,000,000,000 Stars.</p>
          )}
          {isCustomValid && typeof selected?.maxStars === 'number' && customStars > selected.maxStars && (
            <p className={styles.hint}>
              {`This balance covers up to ${selected.maxStars.toLocaleString()} Stars.`}
            </p>
          )}
          <Button fluid disabled={isBusy || !canBuyCustom} onClick={handleCustomBuy}>
            {customPrice ? `Review purchase · ≈ ${customPrice}` : 'Review purchase'}
          </Button>
          {Boolean(options.length) && (
            <Island>
              <StarTopupOptionList
                key={code}
                options={options}
                starsNeeded={starsNeeded}
                formatPrice={formatPrice}
                onClick={handleOption}
              />
            </Island>
          )}
          {selected && !selected.marketAvailable && (
            <p className={styles.hint}>This currency has no price right now. Try again shortly.</p>
          )}
          {selected?.marketAvailable && !options.length && (
            <p className={styles.hint}>
              {selected.maxStars
                ? `This balance covers up to ${selected.maxStars.toLocaleString()} Stars.`
                : `You have no ${coinName(code)} in your Wallet.`}
            </p>
          )}
        </>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!assets && error && <Button fluid disabled={isBusy} onClick={load}>Try again</Button>}
      <Button fluid isText noForcedUpperCase onClick={handleOpenWallet}>Open Wallet</Button>
    </div>
  );
};

export default memo(WalletStarsPurchase);
