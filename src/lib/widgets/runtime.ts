import type { QuickJSHandle } from 'quickjs-emscripten';
import { getQuickJS } from 'quickjs-emscripten';

import { createWidgetCanvasBridge } from './canvas';
import { readWidgetImageSize } from './images';
import { WIDGET_SANDBOX_SOURCE } from './sandbox';
import { runWidgetUtility } from './utilities';

const MAX_NODES = 2000;
const MAX_SCRIPT_BYTES = 32768;
const MAX_MEMORY_BYTES = 8 * 1024 * 1024;
const MAX_STACK_BYTES = 256 * 1024;
const EXECUTION_BUDGET_MS = 30;
const MAX_TIMERS = 64;
const ALLOWED_TAGS = new Set((
  'div span p b strong i em u s del small sub sup h1 h2 h3 h4 h5 h6 ul ol li pre code blockquote br hr '
  + 'table thead tbody tfoot tr th td button a img svg g path rect circle ellipse line polyline polygon '
  + 'text tspan defs symbol lineargradient radialgradient stop clippath mask use title canvas details summary '
  + 'figure figcaption dl dt dd kbd samp var mark time abbr q'
).split(' '));
const SVG_TAGS = new Set((
  'svg g path rect circle ellipse line polyline polygon text tspan defs symbol lineargradient radialgradient '
  + 'stop clippath mask use title'
).split(' '));
const ALLOWED_EVENTS = new Set((
  'click dblclick pointerdown pointerup pointermove pointercancel pointerenter pointerleave pointerover pointerout '
  + 'mousedown mouseup mousemove mouseenter mouseleave mouseover mouseout contextmenu load error toggle '
  + 'animationstart animationend animationiteration transitionend'
).split(' '));
const ALLOWED_ATTRIBUTES = new RegExp(
  '^(id|class|title|role|lang|dir|open|datetime|aria-[\\w-]+|data-[\\w-]+|disabled|hidden|colspan|rowspan'
  + '|width|height|viewbox|d|fill|stroke'
  + '|stroke-width|stroke-linecap|stroke-linejoin|cx|cy|x|y|x1|y1|x2|y2|r|rx|ry|points|transform|opacity|fill-opacity'
  + '|stroke-opacity|offset|stop-color|stop-opacity|text-anchor|font-size|xmlns|preserveaspectratio)$', 'i',
);
const DEFAULT_STYLES = `
:host{display:block;overflow:hidden;max-height:600px;color:var(--color-text);font:inherit}
*{box-sizing:border-box}
button{color:var(--color-links);background:var(--color-background-secondary);border:0;
border-radius:8px;padding:8px 12px;font:inherit;cursor:pointer}
img,svg{max-width:100%}a{color:var(--color-links)}
`;

type WidgetState = {
  chatData: string | undefined;
  publicData: string | undefined;
  viewer?: Record<string, unknown>;
  colorScheme?: string;
  walletAvailable?: boolean;
  language?: string;
  devicePixelRatio?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  themeParams?: Record<string, string>;
};

type WidgetOptions = {
  onStop?: () => void;
  onRequest: (data: string) => Promise<string>;
  onOpenLink: (url: string) => void;
  onWallet?: (action: string, payload: unknown, data: string) => Promise<string>;
};

type DomCommand = {
  action: string;
  id: number;
  name: string;
  value: unknown;
};

export async function createWidgetRuntime(
  container: HTMLElement, html: string, state: WidgetState, options: WidgetOptions,
) {
  const module = await getQuickJS();
  const runtime = module.newRuntime();
  const context = runtime.newContext();
  const shadow = container.attachShadow({ mode: 'closed' });
  const body = document.createElement('div');
  const stylesheet = document.createElement('style');
  const parsed = document.createElement('template');
  const nodes = new Map<number, Node>([[1, body]]);
  const nodeIds = new WeakMap<Node, number>([[body, 1]]);
  const canvas = createWidgetCanvasBridge(nodes);
  const imagePixels = new Map<Element, number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cleanups: (() => void)[] = [];
  const scripts: string[] = [];
  const inlineHandlers: { node: number; type: string; source: string }[] = [];
  let nextNodeId = 2;
  let operationCount = 0;
  let deadline = 0;
  let isDisposed = false;
  let isWatching = false;
  let isInTap = false;
  let hasUsedTap = false;
  let lastBackgroundRequest = 0;
  let walletWindowUntil = 0;
  let executionWindowStart = 0;
  let executionUsed = 0;
  let handle: QuickJSHandle;
  let script: string;
  let inlineHandler: (typeof inlineHandlers)[number];

  function getNodeId(node: Node | undefined | null): number {
    let id = node && nodeIds.get(node);
    if (!node || node === shadow || node === container) return 0;
    if (id) return id;
    if (nodes.size >= MAX_NODES) throw new Error('Widget node limit exceeded');
    id = nextNodeId++;
    nodes.set(id, node);
    nodeIds.set(node, id);
    return id;
  }

  function sanitizeStyle(value: string) {
    const isUnsafe = /\\|url\s*\(|@import|@font-face|image-set|expression\s*\(|-moz-binding|behavior\s*:/i;
    if (value.length > MAX_SCRIPT_BYTES || isUnsafe.test(value)) return '';
    return value;
  }

  function checkTextBudget(extra: number) {
    let total = extra;
    let node: Node;
    let attribute: Attr;
    for (node of nodes.values()) {
      if (!node.parentNode || !nodeIds.has(node.parentNode)) total += node.textContent?.length || 0;
      if (node instanceof Element) {
        for (attribute of Array.from(node.attributes)) total += attribute.value.length;
      }
    }
    if (total > 49152) throw new RangeError('Widget text limit exceeded');
  }

  function setAttribute(element: Element, name: string, value: string) {
    const lower = name.toLowerCase();
    let dimensions: ReturnType<typeof readWidgetImageSize>;
    let pixels: number;
    if (value.length > 8192) throw new RangeError('Widget attribute limit exceeded');
    checkTextBudget(value.length);
    if (element instanceof HTMLCanvasElement && (lower === 'width' || lower === 'height')) {
      if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 2048) {
        throw new RangeError('Invalid canvas size');
      }
      element[lower] = Number(value);
      canvas.validatePixels();
      return;
    }
    if (lower === 'style') {
      element.setAttribute('style', sanitizeStyle(value));
    } else if (lower === 'src' && element.tagName === 'IMG'
      && /^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(value)) {
      dimensions = readWidgetImageSize(value);
      if (!dimensions) return;
      pixels = Array.from(imagePixels.values()).reduce((sum, count) => sum + count, 0)
        - (imagePixels.get(element) || 0) + dimensions.width * dimensions.height;
      if (pixels > 2048 * 2048) throw new RangeError('Widget image limit exceeded');
      imagePixels.set(element, dimensions.width * dimensions.height);
      element.setAttribute('src', value);
    } else if ((lower === 'href' || lower === 'xlink:href') && /^#[\w-]+$/.test(value)) {
      element.setAttribute(name, value);
    } else if (ALLOWED_ATTRIBUTES.test(name) && !/url\s*\(|\\/i.test(value)) {
      element.setAttribute(name, value);
    }
  }

  function appendSafeTree(source: ParentNode, target: Node) {
    const children = Array.from(source.childNodes);
    let child: ChildNode;
    let tag: string;
    let element: Element;
    let attribute: Attr;
    for (child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.appendChild(document.createTextNode(child.textContent || ''));
      } else if (child instanceof Element) {
        tag = child.tagName.toLowerCase();
        if (tag === 'script') {
          if (!child.hasAttribute('src')) scripts.push(child.textContent || '');
          continue;
        }
        if (tag === 'style') {
          element = document.createElement('style');
          element.textContent = sanitizeStyle(child.textContent || '');
          target.appendChild(element);
          continue;
        }
        if (!ALLOWED_TAGS.has(tag)) continue;
        element = SVG_TAGS.has(tag)
          ? document.createElementNS('http://www.w3.org/2000/svg', child.tagName)
          : document.createElement(tag);
        getNodeId(element);
        for (attribute of Array.from(child.attributes)) {
          if (attribute.name.startsWith('on') && ALLOWED_EVENTS.has(attribute.name.slice(2))) {
            inlineHandlers.push({ node: getNodeId(element), type: attribute.name.slice(2), source: attribute.value });
          } else {
            setAttribute(element, attribute.name, attribute.value);
          }
        }
        appendSafeTree(child, element);
        target.appendChild(element);
      }
    }
  }

  function evaluate(code: string) {
    const result = context.evalCode(code);
    let jobs: ReturnType<typeof runtime.executePendingJobs>;
    if (result.error) {
      result.error.dispose();
      throw new Error('Widget execution failed');
    }
    result.value.dispose();
    jobs = runtime.executePendingJobs();
    if (jobs.error) {
      jobs.error.dispose();
      throw new Error('Widget asynchronous execution failed');
    }
  }

  function run(code: string) {
    const started = Date.now();
    let deferred: ReturnType<typeof setTimeout>;
    if (isDisposed) return;
    if (started - executionWindowStart >= 1000) {
      executionWindowStart = started;
      executionUsed = 0;
    }
    if (executionUsed >= EXECUTION_BUDGET_MS * 2) {
      deferred = setTimeout(() => {
        timers.delete(deferred);
        run(code);
      }, 1000 - (started - executionWindowStart));
      timers.add(deferred);
      return;
    }
    deadline = started + EXECUTION_BUDGET_MS;
    canvas.reset();
    operationCount = 0;
    try {
      evaluate(code);
    } catch {
      dispose();
      options.onStop?.();
    } finally {
      executionUsed += Date.now() - started;
    }
  }

  function rejectRequest(id: number, code: string) {
    queueMicrotask(() => run(`__reply(${id},undefined,${JSON.stringify(code)})`));
    return context.undefined;
  }

  function dispatch(id: number, event: Event) {
    const pointer = event as PointerEvent;
    const data = {
      type: event.type,
      target: getNodeId(event.target as Node),
      currentTarget: getNodeId(event.currentTarget as Node),
      clientX: pointer.clientX || 0,
      clientY: pointer.clientY || 0,
      buttons: pointer.buttons || 0,
      pointerId: pointer.pointerId || 0,
    };
    event.preventDefault();
    event.stopPropagation();
    isInTap = event.isTrusted && event.type === 'click';
    hasUsedTap = false;
    run(`__dispatch(${id},${JSON.stringify(data)})`);
    isInTap = false;
  }

  function operate(command: DomCommand): unknown {
    const node = nodes.get(command.id);
    const element = node instanceof Element ? node : undefined;
    const child = nodes.get(Number(command.value));
    const value = typeof command.value === 'string' ? command.value : JSON.stringify(command.value) || '';
    const name = command.name;
    let created: Node;
    let fragment: HTMLTemplateElement;
    let listener: EventListener;
    let timer: (typeof cleanups)[number];
    operationCount++;
    if (operationCount > 10000) throw new RangeError('Widget operation limit exceeded');
    if (command.action === 'utility') {
      return runWidgetUtility(name, command.value as Parameters<typeof runWidgetUtility>[1]);
    }
    if (command.action.startsWith('canvas')) return canvas.execute(command);
    if (command.action === 'create') {
      if (!ALLOWED_TAGS.has(name.toLowerCase())) return 0;
      created = SVG_TAGS.has(name.toLowerCase())
        ? document.createElementNS('http://www.w3.org/2000/svg', name)
        : document.createElement(name);
      return getNodeId(created);
    }
    if (command.action === 'text') return getNodeId(document.createTextNode(value.slice(0, MAX_SCRIPT_BYTES)));
    if (!node) return undefined;
    switch (command.action) {
      case 'get':
        if (name === 'textContent') return node.textContent;
        if (node instanceof HTMLCanvasElement && (name === 'width' || name === 'height')) return node[name];
        if (node instanceof HTMLImageElement
          && ['width', 'height', 'naturalWidth', 'naturalHeight', 'complete'].includes(name)) {
          return node[name as 'width'];
        }
        if (name === 'innerHTML') return element?.innerHTML;
        if (name === 'disabled' || name === 'hidden') return element?.hasAttribute(name);
        return element?.getAttribute(name);
      case 'set':
        checkTextBudget(Math.max(0, value.length - (name === 'textContent' ? node.textContent?.length || 0 : 0)));
        if (node instanceof HTMLCanvasElement && (name === 'width' || name === 'height')) {
          if (Number(value) < 0 || Number(value) > 2048) throw new RangeError('Invalid canvas size');
          node[name] = Number(value);
          canvas.validatePixels();
        } else if (name === 'textContent') node.textContent = value.slice(0, MAX_SCRIPT_BYTES);
        else if (name === 'innerHTML' && element) {
          fragment = document.createElement('template');
          fragment.innerHTML = value.slice(0, MAX_SCRIPT_BYTES);
          element.replaceChildren();
          appendSafeTree(fragment.content, element);
        } else if (element && (name === 'disabled' || name === 'hidden')) {
          element.toggleAttribute(name, Boolean(command.value));
        } else if (element) setAttribute(element, name === 'className' ? 'class' : name, value);
        return undefined;
      case 'attribute': return element?.getAttribute(name);
      case 'setAttribute':
        if (element) setAttribute(element, name, value);
        return undefined;
      case 'removeAttribute':
        element?.removeAttribute(name);
        return undefined;
      case 'query': return getNodeId(element?.querySelector(name.slice(0, 256)));
      case 'queryAll': return Array.from(element?.querySelectorAll(name.slice(0, 256)) || []).map(getNodeId);
      case 'findId': return getNodeId(body.querySelector(`[id="${CSS.escape(name)}"]`));
      case 'relative':
        if (name === 'parentNode' || name === 'parentElement') {
          return getNodeId(node === body ? undefined : node.parentNode);
        }
        if (name === 'firstChild') return getNodeId(node.firstChild);
        if (name === 'lastChild') return getNodeId(node.lastChild);
        if (name === 'nextSibling') return getNodeId(node.nextSibling);
        if (name === 'previousSibling') return getNodeId(node.previousSibling);
        return 0;
      case 'children':
        return Array.from(name === 'children' ? element?.children || [] : node.childNodes).map(getNodeId);
      case 'append':
        if (child && child !== body && !child.contains(node)) node.appendChild(child);
        return undefined;
      case 'remove':
        if (child?.parentNode === node) node.removeChild(child);
        return undefined;
      case 'removeSelf':
        if (node !== body) node.parentNode?.removeChild(node);
        return undefined;
      case 'style':
        if (value.length > 8192) throw new RangeError('Widget style limit exceeded');
        checkTextBudget(value.length);
        if (element instanceof HTMLElement || element instanceof SVGElement) {
          if (name === 'cssText') element.style.cssText = sanitizeStyle(value);
          else {
            element.style.setProperty(
              name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), sanitizeStyle(value),
            );
          }
        }
        return undefined;
      case 'computedStyle':
        return element ? getComputedStyle(element).getPropertyValue(name) : '';
      case 'getStyle':
        if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return '';
        return name === 'cssText' ? element.style.cssText
          : element.style.getPropertyValue(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
      case 'classes':
        if (!element || !Array.isArray(command.value)) return undefined;
        if (name === 'add') element.classList.add(...command.value.map(String));
        if (name === 'remove') element.classList.remove(...command.value.map(String));
        if (name === 'contains') return element.classList.contains(String(command.value[0]));
        if (name === 'toggle') {
          return element.classList.toggle(String(command.value[0]), command.value[1] as boolean | undefined);
        }
        return undefined;
      case 'rect': return element?.getBoundingClientRect().toJSON();
      case 'listen':
        if (!ALLOWED_EVENTS.has(name)) return undefined;
        if (cleanups.length >= MAX_NODES) throw new RangeError('Widget event listener limit exceeded');
        listener = (event) => dispatch(Number(command.value), event);
        node.addEventListener(name, listener);
        timer = () => node.removeEventListener(name, listener);
        cleanups.push(timer);
        return undefined;
      default: return undefined;
    }
  }

  function exposeFunction(name: string, callback: (...args: QuickJSHandle[]) => QuickJSHandle) {
    const value = context.newFunction(name, callback);
    context.setProp(context.global, name, value);
    value.dispose();
  }

  function dispose() {
    let cleanup: () => void;
    if (isDisposed) return;
    isDisposed = true;
    timers.forEach(clearTimeout);
    for (cleanup of cleanups) cleanup();
    context.dispose();
    runtime.dispose();
  }

  runtime.setMemoryLimit(MAX_MEMORY_BYTES);
  runtime.setMaxStackSize(MAX_STACK_BYTES);
  runtime.setInterruptHandler(() => Date.now() > deadline);
  stylesheet.textContent = DEFAULT_STYLES;
  shadow.append(stylesheet, body);
  parsed.innerHTML = html;
  appendSafeTree(parsed.content, body);
  exposeFunction('__host', (value) => {
    let result: unknown;
    try {
      result = operate(JSON.parse(context.getString(value)));
    } catch (error) {
      result = { __widgetError: error instanceof Error ? error.message : 'Invalid widget operation' };
    }
    return context.newString(JSON.stringify(result) || 'null');
  });
  exposeFunction('__watch', (value) => {
    isWatching = Boolean(context.dump(value));
    return context.undefined;
  });
  exposeFunction('__open', (value) => {
    const url = context.getString(value);
    if (isInTap && !hasUsedTap && /^https:\/\//i.test(url) && url.length <= 256) {
      hasUsedTap = true;
      options.onOpenLink(url);
    }
    return context.undefined;
  });
  exposeFunction('__copy', (value) => {
    const text = context.getString(value);
    if (isInTap && !hasUsedTap && text.length > 0 && text.length <= 256) {
      hasUsedTap = true;
      navigator.clipboard?.writeText(text).catch(() => undefined);
    }
    return context.undefined;
  });
  exposeFunction('__schedule', (id, delay) => {
    const callbackId = context.getNumber(id);
    const timeout = context.getNumber(delay);
    let timer: ReturnType<typeof setTimeout>;
    if (timers.size >= MAX_TIMERS) return context.undefined;
    timer = setTimeout(() => {
      timers.delete(timer);
      run(`__dispatch(${callbackId},{})`);
    }, Math.min(timeout, 60000));
    timers.add(timer);
    return context.undefined;
  });
  exposeFunction('__wallet', (id, action, payload, data) => {
    const requestId = context.getNumber(id);
    const operation = context.getString(action);
    const walletPayload = JSON.parse(context.getString(payload)) as unknown;
    const value = context.getString(data);
    if (!options.onWallet || ((!isInTap || hasUsedTap) && Date.now() > walletWindowUntil)) {
      return rejectRequest(requestId, 'NOT_ALLOWED');
    }
    hasUsedTap = true;
    walletWindowUntil = 0;
    options.onWallet(operation, walletPayload, value).then((answer) => {
      run(`__reply(${requestId},${JSON.stringify(answer)},undefined)`);
    }).catch((error: unknown) => {
      const code = error instanceof Error ? error.message : 'FAILED';
      run(`__reply(${requestId},undefined,${JSON.stringify(code)})`);
    });
    return context.undefined;
  });
  exposeFunction('__request', (id, data) => {
    const requestId = context.getNumber(id);
    const value = context.getString(data);
    const isTap = isInTap && !hasUsedTap;
    const now = Date.now();
    const bounds = container.getBoundingClientRect();
    if (isInTap && hasUsedTap) return rejectRequest(requestId, 'NOT_ALLOWED');
    if (!isTap) {
      if (!container.isConnected || document.visibilityState !== 'visible'
        || bounds.bottom < 0 || bounds.top > window.innerHeight) return rejectRequest(requestId, 'NOT_ALLOWED');
      if (now - lastBackgroundRequest < 5000) return rejectRequest(requestId, 'RATE_LIMITED');
      lastBackgroundRequest = now;
    } else {
      hasUsedTap = true;
    }
    options.onRequest(value).then((answer) => {
      if (isTap) walletWindowUntil = Date.now() + 10000;
      run(`__reply(${requestId},${JSON.stringify(answer)},undefined)`);
    }).catch((error: unknown) => {
      const code = error instanceof Error ? error.message : 'FAILED';
      run(`__reply(${requestId},undefined,${JSON.stringify(code)})`);
    });
    return context.undefined;
  });
  deadline = Date.now() + EXECUTION_BUDGET_MS;
  handle = context.unwrapResult(context.evalCode(WIDGET_SANDBOX_SOURCE));
  handle.dispose();
  run(`__update(${JSON.stringify(buildWidgetThemeState(container, state))})`);
  for (inlineHandler of inlineHandlers) {
    run(`document.querySelectorAll('*').forEach(function(node){
      if(node._id===${inlineHandler.node})node.addEventListener(
        ${JSON.stringify(inlineHandler.type)},function(event){${inlineHandler.source}\n})})`);
  }
  for (script of scripts) run(script);
  return {
    dispose,
    update: (next: WidgetState) => run(`__update(${JSON.stringify(buildWidgetThemeState(container, next))})`),
    isWatching: () => isWatching,
  };
}

function buildWidgetThemeState(container: HTMLElement, state: WidgetState): WidgetState {
  const styles = getComputedStyle(container);
  const isDark = document.documentElement.classList.contains('theme-dark');
  const themeParams = {
    bg_color: styles.getPropertyValue('--color-background').trim(),
    text_color: styles.getPropertyValue('--color-text').trim(),
    hint_color: styles.getPropertyValue('--color-text-secondary').trim(),
    link_color: styles.getPropertyValue('--color-links').trim(),
    button_color: styles.getPropertyValue('--color-primary').trim(),
    button_text_color: styles.getPropertyValue('--color-white').trim() || '#ffffff',
    secondary_bg_color: styles.getPropertyValue('--color-background-secondary').trim(),
  };
  return {
    ...state, themeParams, colorScheme: isDark ? 'dark' : 'light', language: navigator.language,
    devicePixelRatio: Math.min(window.devicePixelRatio || 1, 3),
    viewportWidth: container.clientWidth, viewportHeight: container.clientHeight,
  };
}
