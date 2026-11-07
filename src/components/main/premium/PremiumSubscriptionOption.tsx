import type { ChangeEvent } from 'react';
import { memo, useCallback, useMemo } from '../../../lib/teact/teact';

import type { ApiPremiumGiftCodeOption, ApiPremiumSubscriptionOption } from '../../../api/types';

import { STARS_CURRENCY_CODE } from '../../../config';
import buildClassName from '../../../util/buildClassName';
import { formatCurrencyAsString } from '../../../util/formatCurrency';

import useLang from '../../../hooks/useLang';

import styles from './PremiumSubscriptionOption.module.scss';

type OwnProps = {
  option: ApiPremiumSubscriptionOption | ApiPremiumGiftCodeOption;
  isGiveaway?: boolean;
  checked?: boolean;
  fullMonthlyAmount?: number;
  className?: string;
  onChange: (month: number) => void;
};

const PremiumSubscriptionOption = ({
  option, checked, fullMonthlyAmount,
  onChange, className, isGiveaway,
}: OwnProps) => {
  const lang = useLang();

  const {
    months, amount, currency,
  } = option;
  const users = 'users' in option ? option.users : undefined;
  const perMonth = Math.floor(amount / months);
  // Greengram: plans are priced in Stars, and "XTR" means nothing to a reader
  const formatPrice = (value: number) => (currency === STARS_CURRENCY_CODE
    ? `★${value.toLocaleString(lang.code)}`
    : formatCurrencyAsString(value, currency, lang.code));
  const isUserCountPlural = users ? users > 1 : undefined;

  const discount = useMemo(() => {
    return fullMonthlyAmount && fullMonthlyAmount > perMonth
      ? Math.ceil(100 - perMonth / (fullMonthlyAmount / 100))
      : undefined;
  }, [fullMonthlyAmount, perMonth]);

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      onChange(months);
    }
  }, [months, onChange]);

  return (
    <label
      className={buildClassName(
        isGiveaway ? styles.giveawayWrapper : styles.wrapper,
        (checked && !isGiveaway) && styles.active,
        className,
      )}
      dir={lang.isRtl ? 'rtl' : undefined}
    >
      <input
        className={styles.input}
        type="radio"
        name="subscription_option"
        value={months}
        checked={checked}
        onChange={handleChange}
      />
      <div className={styles.content}>
        <div className={styles.month}>
          {Boolean(discount) && (
            <span
              className={buildClassName(styles.giveawayDiscount, styles.discount)}
              title={lang('GiftDiscount', { percent: discount })}
            >
              {lang('GiftDiscount', { percent: discount })}
            </span>
          )}
          {lang('Months', { count: months }, { pluralValue: months })}
        </div>
        <div className={styles.perMonth}>
          {(isGiveaway || isUserCountPlural) ? `${formatPrice(amount)} x ${users!}`
            : lang('PricePerMonth', { amount: formatPrice(perMonth) })}
        </div>
        <div className={styles.amount}>
          {formatPrice(amount)}
        </div>
      </div>
    </label>
  );
};

export default memo(PremiumSubscriptionOption);
