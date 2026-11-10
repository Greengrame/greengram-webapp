const INTL_TYPES = new Set([
  'NumberFormat', 'DateTimeFormat', 'PluralRules', 'RelativeTimeFormat', 'ListFormat', 'Collator',
]);
const INTL_METHODS = new Set([
  'format', 'formatToParts', 'formatRange', 'formatRangeToParts', 'select', 'selectRange', 'compare', 'resolvedOptions',
]);

type UtilityInput = {
  text?: string;
  bytes?: number[];
  length?: number;
  type?: string;
  method?: string;
  locales?: string | string[];
  options?: Record<string, unknown>;
  args?: unknown[];
  base?: string;
  key?: string;
  value?: string;
};
type IntlResult = Record<string, (...args: unknown[]) => unknown>;
type IntlConstructor = new (locales?: string | string[], options?: Record<string, unknown>) => IntlResult;

export function runWidgetUtility(name: string, input: UtilityInput): unknown {
  let bytes: Uint8Array<ArrayBuffer>;
  let url: URL;
  let formatter: IntlResult;
  let parameters: URLSearchParams;
  let result: unknown;
  let constructor: IntlConstructor;
  if (JSON.stringify(input).length > 262144) throw new RangeError('Widget utility input is too large');
  switch (name) {
    case 'randomUuid': return crypto.randomUUID();
    case 'randomBytes':
      if (!Number.isInteger(input.length) || input.length! < 0 || input.length! > 65536) {
        throw new RangeError('Invalid random byte count');
      }
      bytes = new Uint8Array(input.length!);
      crypto.getRandomValues(bytes);
      return Array.from(bytes);
    case 'encode': return Array.from(new TextEncoder().encode(input.text || ''));
    case 'decode':
      return new TextDecoder(input.type || 'utf-8', input.options).decode(new Uint8Array(input.bytes || []));
    case 'atob': return atob(input.text || '');
    case 'btoa': return btoa(input.text || '');
    case 'url':
      url = new URL(input.text || '', input.base);
      if (input.key && ['href', 'protocol', 'host', 'hostname', 'port', 'pathname',
        'search', 'hash', 'username', 'password']
        .includes(input.key)) url[input.key as 'href'] = input.value || '';
      return {
        href: url.href, origin: url.origin, protocol: url.protocol, host: url.host, hostname: url.hostname,
        port: url.port, pathname: url.pathname, search: url.search, hash: url.hash,
        username: url.username, password: url.password,
      };
    case 'searchParams':
      parameters = new URLSearchParams(input.text);
      switch (input.method) {
        case 'append': parameters.append(String(input.args?.[0]), String(input.args?.[1]));
          break;
        case 'set': parameters.set(String(input.args?.[0]), String(input.args?.[1]));
          break;
        case 'delete': parameters.delete(String(input.args?.[0]));
          break;
        case 'sort': parameters.sort();
          break;
        case 'get': result = parameters.get(String(input.args?.[0]));
          break;
        case 'getAll': result = parameters.getAll(String(input.args?.[0]));
          break;
        case 'has': result = parameters.has(String(input.args?.[0]));
          break;
        default: break;
      }
      return { value: parameters.toString(), entries: Array.from(parameters.entries()), result };
    case 'intl':
      if (!INTL_TYPES.has(input.type!) || !INTL_METHODS.has(input.method!)) return undefined;
      constructor = (Intl as unknown as Record<string, IntlConstructor>)[input.type!];
      formatter = new constructor(input.locales, input.options);
      return formatter[input.method!](...(input.args || []));
    default: return undefined;
  }
}
