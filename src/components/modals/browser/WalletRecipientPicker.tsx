import { memo, useMemo, useState } from '../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../global';

import type { ApiChatType, ApiUser } from '../../../api/types';
import type { TabState } from '../../../global/types';
import type { WebApp } from '../../../types/webapp';

import { SERVICE_NOTIFICATIONS_USER_ID } from '../../../config';
import { isDeletedUser, isUserBot } from '../../../global/helpers';
import { selectTabState, selectUser } from '../../../global/selectors';

import useDebouncedCallback from '../../../hooks/useDebouncedCallback';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import RecipientPicker from '../../common/RecipientPicker';

type OwnProps = {
  isOpen: boolean;
  onSelect: (userId: string) => void;
  onClose: NoneToVoidFunction;
  onCloseAnimationEnd: NoneToVoidFunction;
};

type StateProps = {
  search?: TabState['walletRecipientSearch'];
};

const WALLET_BOT_USERNAME = 'wallet';
const PEOPLE_ONLY: ApiChatType[] = ['users'];
const SEARCH_DEBOUNCE_MS = 300;

// The event hands a user id to the frame, so a bot's own page can't ask for it
export function isWalletWebApp(webApp?: WebApp, bot?: ApiUser) {
  if (!webApp || !bot?.usernames?.some(({ username }) => username === WALLET_BOT_USERNAME)) return false;
  try {
    return new URL(webApp.url).origin === window.location.origin;
  } catch (err) {
    return false;
  }
}

// Same rule as the server's recipient check: a person, not yourself. Saved Messages would be a transfer to yourself.
function canReceiveTransfer(id: string) {
  const global = getGlobal();
  const user = selectUser(global, id);
  return user !== undefined && id !== global.currentUserId && id !== SERVICE_NOTIFICATIONS_USER_ID
    && !isUserBot(user) && !isDeletedUser(user);
}

const WalletRecipientPicker = ({
  isOpen,
  search,
  onSelect,
  onClose,
  onCloseAnimationEnd,
}: OwnProps & StateProps) => {
  const { searchWalletRecipients } = getActions();
  const lang = useLang();
  const [query, setQuery] = useState('');

  const debouncedSearch = useDebouncedCallback((value: string) => {
    searchWalletRecipients({ query: value });
  }, [], SEARCH_DEBOUNCE_MS, true);

  const handleSearchChange = useLastCallback((value: string) => {
    const trimmed = value.trim();
    setQuery(trimmed);
    if (trimmed) debouncedSearch(trimmed);
  });

  const extraSearchIds = useMemo(() => {
    if (!query || search?.query !== query) return undefined;
    return [...search.localUserIds, ...search.globalUserIds];
  }, [query, search]);

  return (
    <RecipientPicker
      isOpen={isOpen}
      title={lang('SelectChat')}
      searchPlaceholder={lang('Search')}
      filter={PEOPLE_ONLY}
      peerFilter={canReceiveTransfer}
      extraSearchIds={extraSearchIds}
      noResultsText={lang(query ? 'WalletRecipientNotFound' : 'WalletRecipientEmpty')}
      onSearchChange={handleSearchChange}
      onSelectRecipient={onSelect}
      onClose={onClose}
      onCloseAnimationEnd={onCloseAnimationEnd}
    />
  );
};

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => ({
    search: selectTabState(global).walletRecipientSearch,
  }),
)(WalletRecipientPicker));
