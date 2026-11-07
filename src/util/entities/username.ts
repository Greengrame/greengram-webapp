// Greengram: admins list shorter and digit-only names on Fragment, links to them must open
export const MIN_USERNAME_LENGTH = 1;
export const MIN_UPDATE_USERNAME_LENGTH = 5; // 4 letter usernames are only available on Fragment
export const MAX_USERNAME_LENGTH = 32;
export const USERNAME_REGEX = /^[a-zA-Z]\w+$/;
const COLLECTIBLE_USERNAME_REGEX = /^\w+$/;

export function isUsernameValid(username: string, isUpdating?: boolean) {
  const minUsernameLength = isUpdating ? MIN_UPDATE_USERNAME_LENGTH : MIN_USERNAME_LENGTH;
  return username.length >= minUsernameLength
    && username.length <= MAX_USERNAME_LENGTH
    && (isUpdating ? USERNAME_REGEX : COLLECTIBLE_USERNAME_REGEX).test(username);
}
