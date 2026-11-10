import { memo, useEffect, useState } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { TabState } from '../../global/types';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Button from '../ui/Button';
import Modal from '../ui/Modal';

type OwnProps = { modal: TabState['createManagedBotModal'] };

function CreateManagedBotModal({ modal }: OwnProps) {
  const { closeCreateManagedBotModal, createManagedBot } = getActions();
  const lang = useLang();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const handleSubmit = useLastCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createManagedBot({ name: name.trim(), username: username.trim().replace(/^@/, '') });
  });
  const handleClose = useLastCallback(() => {
    if (!modal?.isCreating) closeCreateManagedBotModal();
  });
  useEffect(() => {
    setName(modal?.suggestedName || '');
    setUsername(modal?.suggestedUsername || '');
  }, [modal?.botId, modal?.buttonId, modal?.suggestedName, modal?.suggestedUsername]);
  return (
    <Modal title={lang('ManagedBotCreateTitle')} isOpen={Boolean(modal)} onClose={handleClose}>
      <form onSubmit={handleSubmit}>
        <p>{lang('ManagedBotCreateInfo')}</p>
        <div className="input-group">
          <input
            className="form-control"
            aria-label={lang('ManagedBotName')}
            placeholder={lang('ManagedBotName')}
            value={name}
            maxLength={64}
            disabled={modal?.isCreating}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </div>
        <div className="input-group">
          <input
            className="form-control"
            aria-label={lang('ManagedBotUsername')}
            placeholder={lang('ManagedBotUsername')}
            value={username}
            maxLength={32}
            disabled={modal?.isCreating}
            onInput={(event) => setUsername(event.currentTarget.value)}
          />
        </div>
        <Button type="submit" disabled={!name.trim() || !username.trim() || modal?.isCreating}>
          {lang('ManagedBotCreateAction')}
        </Button>
      </form>
    </Modal>
  );
}

export default memo(CreateManagedBotModal);
