import { memo, useEffect, useRef, useState } from '../../../lib/teact/teact';
import { getActions } from '../../../global';

import type { WidgetWalletConsent } from './WidgetWalletDialog';

import { createWidgetRuntime } from '../../../lib/widgets/runtime';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import WidgetWalletDialog from './WidgetWalletDialog';

import './Widget.scss';

const WIDGET_POLL_MS = 1000;
const MAX_HEIGHT = 600;
const MIN_HEIGHT = 50;
const MIN_WIDTH = 200;

type OwnProps = { url: string };
type WidgetResponse = {
  widget: { html: string; public_data?: string; chat_data?: string; width?: number; height?: number; id?: string };
  viewer: Record<string, unknown>;
  allow_queries: boolean;
  cache_time: number;
  wallet_available: boolean;
  bot_name: string;
};

function Widget({ url }: OwnProps) {
  const containerRef = useRef<HTMLDivElement>();
  const consentRef = useRef<WidgetWalletConsent>();
  const [consent, setConsent] = useState<WidgetWalletConsent>();
  const [isStopped, setIsStopped] = useState(false);
  const lang = useLang();
  const resolveConsent = useLastCallback((passcode: string | undefined) => {
    consentRef.current?.resolve(passcode);
    consentRef.current = undefined;
    setConsent(undefined);
  });
  const requestConsent = useLastCallback((summary: string, needsPasscode: boolean) => new Promise<string | undefined>(
    (resolve) => {
      const next = { summary, needsPasscode, resolve };
      if (consentRef.current) resolveConsent(undefined);
      consentRef.current = next;
      setConsent(next);
    },
  ));

  useEffect(() => {
    const controller = new AbortController();
    const target = containerRef.current!;
    const host = document.createElement('div');
    let runtime: Awaited<ReturnType<typeof createWidgetRuntime>> | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let isDisposed = false;
    let lastRefresh = 0;
    let queryTimes: number[] = [];
    let current: WidgetResponse | undefined;
    let publicData: string | undefined;
    let lastPublicRefresh = 0;
    let walletAllowedUntil = 0;

    async function refresh() {
      let response: Response;
      let envelope: { ok: boolean; result: WidgetResponse };
      let next: WidgetResponse;
      try {
        response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
        envelope = await response.json();
        if (!response.ok || !envelope.ok || isDisposed) return;
        next = envelope.result;
        if (!runtime) {
          current = next;
          publicData = next.widget.public_data;
          lastPublicRefresh = Date.now();
          host.style.height = next.widget.height
            ? `${Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, next.widget.height))}px` : '';
          host.style.width = next.widget.width ? `${Math.max(MIN_WIDTH, next.widget.width)}px` : '';
          runtime = await createWidgetRuntime(host, next.widget.html, {
            chatData: next.widget.chat_data,
            publicData: next.widget.public_data,
            viewer: next.allow_queries ? next.viewer : undefined,
            walletAvailable: next.wallet_available,
          }, {
            onRequest: sendQuery,
            onOpenLink: openLink,
            onWallet: sendWallet,
            onStop: () => {
              setIsStopped(true);
              resolveConsent(undefined);
            },
          });
          if (isDisposed) runtime.dispose();
        } else {
          if (!next.widget.id || (runtime.isWatching() && Date.now() - lastPublicRefresh >= next.cache_time * 1000)) {
            publicData = next.widget.public_data;
            lastPublicRefresh = Date.now();
          }
          runtime.update({
            chatData: next.widget.chat_data,
            publicData,
            viewer: next.allow_queries ? next.viewer : undefined,
            walletAvailable: next.wallet_available,
          });
        }
        current = next;
        lastRefresh = Date.now();
      } catch {
        if (!controller.signal.aborted) lastRefresh = Date.now();
      } finally {
        if (!isDisposed) {
          timer = setTimeout(refresh, Math.max(WIDGET_POLL_MS, lastRefresh - Date.now() + WIDGET_POLL_MS));
        }
      }
    }

    async function sendQuery(data: string) {
      const now = Date.now();
      const isTap = navigator.userActivation.isActive;
      let response: Response;
      let envelope: { ok: boolean; result: { data: string } };
      if (!current?.allow_queries || new TextEncoder().encode(data).length > 64) throw new Error('QUERIES_DISABLED');
      queryTimes = queryTimes.filter((time) => now - time < 5000);
      if (queryTimes.length >= 5) throw new Error('RATE_LIMITED');
      queryTimes.push(now);
      response = await fetch(`${url}/query`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      envelope = await response.json();
      if (!response.ok || !envelope.ok) throw new Error('REQUEST_FAILED');
      if (isTap) walletAllowedUntil = Date.now() + 10000;
      return envelope.result.data;
    }

    async function sendWallet(action: string, payload: unknown, data: string) {
      const requestId = crypto.randomUUID();
      let summary: string;
      let passcode: string | undefined;
      let response: Response;
      let envelope: { ok: boolean; result: { data: string }; description?: string };
      let messages: { address: string; amount: string }[];
      let details: string;
      if (!current?.wallet_available || !current.allow_queries) throw new Error('NOT_ALLOWED');
      if (!navigator.userActivation.isActive && Date.now() > walletAllowedUntil) throw new Error('NOT_ALLOWED');
      walletAllowedUntil = 0;
      if (JSON.stringify(payload).length > 16384) throw new Error('BAD_REQUEST');
      if (action === 'card') {
        summary = lang('WidgetWalletShareCard', { bot: current.bot_name });
      } else if (action === 'send_transaction') {
        messages = (payload as { messages: { address: string; amount: string }[] }).messages;
        if (!Array.isArray(messages) || !messages.length || messages.length > 255) throw new Error('BAD_REQUEST');
        details = messages.map((message) => `${formatGram(message.amount)} GRAM → ${message.address}`).join('\n');
        summary = lang('WidgetWalletSend', { bot: current.bot_name, details });
      } else if (action === 'sign_data') {
        summary = lang('WidgetWalletSign', { bot: current.bot_name, text: JSON.stringify(payload) });
      } else {
        throw new Error('BAD_REQUEST');
      }
      passcode = await requestConsent(summary, action !== 'card');
      if (passcode === undefined) throw new Error('REJECTED');
      response = await fetch(`${url}/wallet`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload, data, passcode, request_id: requestId }),
      });
      envelope = await response.json();
      if (!response.ok || !envelope.ok) throw new Error(envelope.description || 'FAILED');
      return envelope.result.data;
    }

    function openLink(link: string) {
      getActions().openUrl({ url: link });
    }

    setIsStopped(false);
    target.appendChild(host);
    void refresh();
    return () => {
      isDisposed = true;
      controller.abort();
      consentRef.current?.resolve(undefined);
      consentRef.current = undefined;
      clearTimeout(timer);
      runtime?.dispose();
      host.remove();
    };
  }, [url, lang, requestConsent, resolveConsent]);

  return (
    <>
      <div ref={containerRef} className="Widget" />
      {isStopped && <p className="Widget-wallet-summary">{lang('WidgetStopped')}</p>}
      <WidgetWalletDialog consent={consent} onResolve={resolveConsent} />
    </>
  );
}

function formatGram(value: string) {
  const amount = BigInt(value);
  const whole = amount / 1000000000n;
  const fraction = (amount % 1000000000n).toString().padStart(9, '0').replace(/0+$/, '');
  if (amount <= 0n) throw new Error('BAD_REQUEST');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export default memo(Widget);
