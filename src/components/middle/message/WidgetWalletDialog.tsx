import { memo, useEffect, useState } from '../../../lib/teact/teact';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';
import Modal from '../../ui/Modal';

export type WidgetWalletConsent = {
  summary: string;
  needsPasscode: boolean;
  resolve: (passcode: string | undefined) => void;
};

type OwnProps = {
  consent?: WidgetWalletConsent;
  onResolve: (passcode: string | undefined) => void;
};

function WidgetWalletDialog({ consent, onResolve }: OwnProps) {
  const lang = useLang();
  const [passcode, setPasscode] = useState('');
  const handleClose = useLastCallback(() => {
    onResolve(undefined);
    setPasscode('');
  });
  const handleSubmit = useLastCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onResolve(consent?.needsPasscode ? passcode : '');
    setPasscode('');
  });

  useEffect(() => {
    setPasscode('');
  }, [consent]);

  return (
    <Modal title={lang('WalletConnectTransfer')} isOpen={Boolean(consent)} onClose={handleClose}>
      <form className="Widget-wallet-form" onSubmit={handleSubmit}>
        <p className="Widget-wallet-summary">{consent?.summary}</p>
        {consent?.needsPasscode && (
          <div className="input-group">
            <input
              className="form-control"
              type="password"
              autoComplete="current-password"
              inputMode="numeric"
              maxLength={32}
              placeholder={lang('WalletPasscodeTitle')}
              aria-label={lang('WalletPasscodeTitle')}
              value={passcode}
              onInput={(event) => setPasscode(event.currentTarget.value)}
            />
          </div>
        )}
        <Button type="submit" disabled={consent?.needsPasscode && !passcode}>{lang('AutoDeleteConfirm')}</Button>
      </form>
    </Modal>
  );
}

export default memo(WidgetWalletDialog);
