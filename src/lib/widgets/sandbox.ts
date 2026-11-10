export const WIDGET_SANDBOX_SOURCE = String.raw`
(function () {
  var callbacks = new Map();
  var requests = new Map();
  var events = new Map();
  var nextId = 1;
  var nodes = new Map();
 var localWallet;
  function host(action, id, name, value) {
    var result = JSON.parse(__host(JSON.stringify({ action: action, id: id, name: name, value: value })));
    if (result && result.__widgetError) throw new RangeError(result.__widgetError);
    return result;
  }
  function wrap(id) {
    var node;
    if (!id) return null;
    if (nodes.has(id)) return nodes.get(id);
    node = new WidgetNode(id);
    nodes.set(id, node);
    return node;
  }
  function WidgetNode(id) {
    this._id = id;
    this.style = new Proxy({}, {
      get: function (_, key) {
        if (key === 'setProperty') return function (name, value) {
      host('style', id, name, String(value));
    };
        if (key === 'removeProperty') return function (name) {
      host('style', id, name, '');
    };
        return host('getStyle', id, String(key));
      },
      set: function (_, key, value) {
      host('style', id, String(key), String(value));
    return true;
    }
    });
    this.dataset = new Proxy({}, {
      get: function (_, key) {
      return host('attribute', id, 'data-' + String(key).replace(/[A-Z]/g, function (c) {
      return '-' + c.toLowerCase();
    }));
    },
      set: function (_, key, value) {
      host('setAttribute', id, 'data-' + String(key).replace(/[A-Z]/g, function (c) {
      return '-' + c.toLowerCase();
    }), String(value));
    return true;
    }
    });
    this.classList = {
      add: function () {
      host('classes', id, 'add', Array.from(arguments));
    },
      remove: function () {
      host('classes', id, 'remove', Array.from(arguments));
    },
      toggle: function (name, force) {
      return host('classes', id, 'toggle', [name, force]);
    },
      contains: function (name) {
      return host('classes', id, 'contains', [name]);
    }
    };
  }
  ['textContent', 'innerHTML', 'id', 'className', 'disabled', 'hidden', 'value',
 'width', 'height', 'naturalWidth', 'naturalHeight', 'complete', 'src'].forEach(function (name) {
    Object.defineProperty(WidgetNode.prototype, name, {
      get: function () {
      return host('get', this._id, name);
    },
      set: function (value) {
      host('set', this._id, name, value);
    }
    });
  });
  ['parentNode', 'parentElement', 'firstChild', 'lastChild', 'nextSibling', 'previousSibling'].forEach(function (name) {
    Object.defineProperty(WidgetNode.prototype, name, { get: function () {
      return wrap(host('relative', this._id, name));
    } });
  });
  ['children', 'childNodes'].forEach(function (name) {
    Object.defineProperty(WidgetNode.prototype, name, { get: function () {
      return host('children', this._id, name).map(wrap);
    } });
  });
  ['click','dblclick','pointerdown','pointerup','pointermove','pointercancel','contextmenu','load','error']
 .forEach(function(type) {
    Object.defineProperty(WidgetNode.prototype,'on'+type,{
      set:function(callback) { if(typeof callback==='function') this.addEventListener(type,callback); }
    });
  });
  WidgetNode.prototype.querySelector = function (selector) {
      return wrap(host('query', this._id, selector));
    };
  WidgetNode.prototype.querySelectorAll = function (selector) {
      return host('queryAll', this._id, selector).map(wrap);
    };
  WidgetNode.prototype.setAttribute = function (name, value) {
      host('setAttribute', this._id, String(name), String(value));
    };
  WidgetNode.prototype.getAttribute = function (name) {
      return host('attribute', this._id, String(name));
    };
  WidgetNode.prototype.removeAttribute = function (name) {
      host('removeAttribute', this._id, String(name));
    };
  WidgetNode.prototype.appendChild = function (node) {
      host('append', this._id, '', node._id);
    return node;
    };
  WidgetNode.prototype.removeChild = function (node) {
      host('remove', this._id, '', node._id);
    return node;
    };
  WidgetNode.prototype.remove = function () {
      host('removeSelf', this._id);
    };
  WidgetNode.prototype.append = function () {
    var self = this;
    Array.from(arguments).forEach(function (node) {
      self.appendChild(typeof node === 'string' ? document.createTextNode(node) : node);
    });
  };
  WidgetNode.prototype.replaceChildren = function () { this.textContent = '';
    this.append.apply(this, arguments);
    };
  WidgetNode.prototype.getBoundingClientRect = function () {
      return host('rect', this._id);
    };
  WidgetNode.prototype.addEventListener = function (type, callback) {
    var id = nextId++;
    callbacks.set(id, callback.bind(this));
    host('listen', this._id, String(type), id);
  };
  function wrapCanvasResource(value) {
    if (value && value._canvasResource) {
      value.addColorStop = function (offset, color) {
        host('canvasResource', this._canvasResource, 'addColorStop', [offset, color]);
      };
    }
    return value;
  }
  function CanvasContext(id) {
    return new Proxy({}, {
      get: function (_, key) {
        if ('fillStyle strokeStyle lineWidth lineCap lineJoin miterLimit lineDashOffset font textAlign textBaseline '
          .concat('direction globalAlpha imageSmoothingEnabled imageSmoothingQuality').split(' ').includes(key)) {
          return wrapCanvasResource(host('canvasGet', id, String(key)));
        }
        return function () {
          return wrapCanvasResource(host('canvasCall', id, String(key), Array.from(arguments)));
        };
      },
      set: function (_, key, value) { host('canvasSet', id, String(key), value); return true; }
    });
  }
  WidgetNode.prototype.getContext = function (kind) {
    return kind === '2d' ? new CanvasContext(this._id) : null;
  };
  globalThis.Path2D = function (value) {
    var resource = host('canvasPath', 0, '', value);
    this._canvasResource = resource._canvasResource;
  };
  'moveTo lineTo bezierCurveTo quadraticCurveTo arc arcTo ellipse rect roundRect closePath'.split(' ')
    .forEach(function (name) {
      Path2D.prototype[name] = function () {
        host('canvasResource', this._canvasResource, name, Array.from(arguments));
      };
    });
  globalThis.Image = function (width, height) {
    var image = document.createElement('img');
    if (width) image.width = width;
    if (height) image.height = height;
    return image;
  };
  globalThis.document = {
    body: wrap(1),
    documentElement: wrap(1),
    getElementById: function (id) {
      return wrap(host('findId', 1, String(id)));
    },
    querySelector: function (selector) {
      return wrap(host('query', 1, String(selector)));
    },
    querySelectorAll: function (selector) {
      return host('queryAll', 1, String(selector)).map(wrap);
    },
    createElement: function (tag) {
      return wrap(host('create', 0, String(tag)));
    },
    createElementNS: function (_, tag) {
      return wrap(host('create', 0, String(tag)));
    },
    createTextNode: function (text) {
      return wrap(host('text', 0, '', String(text)));
    },
    addEventListener: function (type, callback) { if (type === 'DOMContentLoaded') callback();
    }
  };
  function disabledNetwork() { var error = new Error('Network is disabled');
    error.name = 'NetworkDisabledError';
    throw error;
    }
  globalThis.fetch = disabledNetwork;
  globalThis.XMLHttpRequest = disabledNetwork;
  globalThis.WebSocket = disabledNetwork;
  globalThis.EventSource = disabledNetwork;
  globalThis.Worker = disabledNetwork;
  globalThis.BroadcastChannel = disabledNetwork;
  globalThis.RTCPeerConnection = disabledNetwork;
  globalThis.importScripts = disabledNetwork;
  globalThis.navigator = { language: 'en', sendBeacon: disabledNetwork };
  globalThis.alert = function () {};
  globalThis.print = function () {};
  globalThis.confirm = function () { return false; };
  globalThis.prompt = function () { return null; };
  globalThis.window = globalThis;
  globalThis.open = function (url) { TelegramWidget.openLink(url); };
  globalThis.getComputedStyle = function (node) {
    return new Proxy({}, { get: function (_,key) {
      if (key === 'getPropertyValue') return function (name) { return host('computedStyle',node._id,name); };
      return host('computedStyle',node._id,String(key).replace(/[A-Z]/g,function(letter){
 return '-'+letter.toLowerCase();
 }));
    } });
  };
  globalThis.TextEncoder = function () { this.encoding = 'utf-8'; };
  TextEncoder.prototype.encode = function (value) {
    return new Uint8Array(host('utility',0,'encode',{text:String(value === undefined ? '' : value)}));
  };
  globalThis.TextDecoder = function (encoding,options) {
 this.encoding=encoding || 'utf-8';this.options=options || {};
 };
  TextDecoder.prototype.decode = function (value) {
    var bytes=value ? new Uint8Array(value.buffer || value,value.byteOffset || 0,value.byteLength) : new Uint8Array();
    return host('utility',0,'decode',{type:this.encoding,options:this.options,bytes:Array.from(bytes)});
  };
  globalThis.crypto = {
    randomUUID:function () { return host('utility',0,'randomUuid',{}); },
    getRandomValues:function (array) {
      var bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
      bytes.set(host('utility',0,'randomBytes',{length:bytes.length}));
      return array;
    }
  };
  globalThis.atob = function (value) { return host('utility',0,'atob',{text:String(value)}); };
  globalThis.btoa = function (value) { return host('utility',0,'btoa',{text:String(value)}); };
  globalThis.URLSearchParams = function (value,notify) {
    var self=this;
    this._notify=notify;
    if (value && typeof value==='object') {
      this._value='';
      if (Array.isArray(value)) value.forEach(function(pair){ self.append(pair[0],pair[1]); });
      else Object.keys(value).forEach(function(key){ self.append(key,value[key]); });
    } else this._value=String(value || '').replace(/^\?/,'');
  };
  'append set delete sort get getAll has'.split(' ').forEach(function(method){
    URLSearchParams.prototype[method]=function(){
      var result=host('utility',0,'searchParams',{text:this._value,method:method,args:Array.from(arguments)});
      this._value=result.value;
      if(this._notify) this._notify(this._value);
      return result.result;
    };
  });
  URLSearchParams.prototype.toString=function(){ return this._value; };
  URLSearchParams.prototype.entries=function(){
    return host('utility',0,'searchParams',{text:this._value}).entries[Symbol.iterator]();
  };
  URLSearchParams.prototype[Symbol.iterator]=URLSearchParams.prototype.entries;
  URLSearchParams.prototype.forEach=function(callback,thisArg){
    var self=this;
    Array.from(this.entries()).forEach(function(pair){ callback.call(thisArg,pair[1],pair[0],self); });
  };
  globalThis.URL = function (value,base) {
    var target=this;
    Object.assign(target,host('utility',0,'url',{text:String(value),base:base ? String(base) : undefined}));
    return new Proxy(target,{
      get:function(_,key){
        if(key==='searchParams') return new URLSearchParams(target.search,function(search){
          Object.assign(target,host('utility',0,'url',{text:target.href,key:'search',value:search}));
        });
        return target[key];
      },
      set:function(_,key,value){
        Object.assign(target,host('utility',0,'url',{text:target.href,key:String(key),value:String(value)}));
        return true;
      }
    });
  };
  URL.prototype.toString = function () { return this.href; };
  URL.prototype.toJSON = URL.prototype.toString;
  globalThis.Intl = {};
  'NumberFormat DateTimeFormat PluralRules RelativeTimeFormat ListFormat Collator'.split(' ').forEach(function (type) {
    Intl[type]=function (locales,options) { this.locales=locales;this.options=options; };
    'format formatToParts formatRange formatRangeToParts select selectRange compare resolvedOptions'.split(' ')
      .forEach(function (method) {
        Intl[type].prototype[method]=function () {
          return host('utility',0,'intl',{
            type:type,method:method,locales:this.locales,options:this.options,args:Array.from(arguments)
          });
        };
      });
  });
  globalThis.structuredClone = function (value) {
    var seen=new Map();
    function clone(input) {
      var output;
      if(!input || typeof input!=='object') return input;
      if(seen.has(input)) return seen.get(input);
      if(input instanceof Date) return new Date(input.getTime());
      if(input instanceof RegExp) return new RegExp(input.source,input.flags);
      if(input instanceof ArrayBuffer) return input.slice(0);
      if(ArrayBuffer.isView(input)) return new input.constructor(input);
      if(input instanceof Map) {
        output=new Map();seen.set(input,output);
        input.forEach(function(item,key){ output.set(clone(key),clone(item)); });return output;
      }
      if(input instanceof Set) {
        output=new Set();seen.set(input,output);
        input.forEach(function(item){ output.add(clone(item)); });return output;
      }
      output=Array.isArray(input)?[]:{};seen.set(input,output);
      Object.keys(input).forEach(function(key){ output[key]=clone(input[key]); });return output;
    }
    return clone(value);
  };
  globalThis.AbortController = function () {
    var listeners=[];
    this.signal={
      aborted:false,reason:undefined,onabort:null,
      addEventListener:function(type,callback){ if(type==='abort') listeners.push(callback); },
      removeEventListener:function(type,callback){
 if(type==='abort') listeners=listeners.filter(function(fn){return fn!==callback;});
 },
      throwIfAborted:function(){ if(this.aborted) throw this.reason; }
    };
    this.abort=function(reason){
      var signal=this.signal;
      var error;
      if(signal.aborted) return;
      if(reason===undefined){ error=new Error('Aborted');error.name='AbortError';reason=error; }
      signal.aborted=true;signal.reason=reason;
      listeners.forEach(function(callback){ callback({type:'abort',target:signal}); });
      if(signal.onabort) signal.onabort({type:'abort',target:signal});
    };
  };
  WidgetNode.prototype.focus=function(){};
  WidgetNode.prototype.blur=function(){};
  function createStorage() {
    var values = new Map();
    return {
      get length() { return values.size; },
      getItem:function(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
      setItem:function(key,value) {
        var size = 0;
        var error;
        key = String(key);
        value = String(value);
        values.forEach(function(stored,name) {
          if(name!==key) size+=encodeURIComponent(name+stored).replace(/%[0-9A-F]{2}/g,'x').length;
        });
        size += encodeURIComponent(key+value).replace(/%[0-9A-F]{2}/g,'x').length;
        if(size>4096) { error=new Error('Storage quota exceeded'); error.name='QuotaExceededError'; throw error; }
        values.set(key,value);
      },
      removeItem:function(key) { values.delete(String(key)); },
      clear:function() { values.clear(); },
      key:function(index) { return Array.from(values.keys())[index] || null; }
    };
  }
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();
  globalThis.console = { log: function () {}, warn: function () {}, error: function () {} };
  globalThis.setTimeout = function (callback, delay) { var id = nextId++;
    callbacks.set(id, function () { callbacks.delete(id); callback(); });
    __schedule(id, Math.max(16, Number(delay) || 0));
    return id;
    };
  globalThis.clearTimeout = function (id) {
      callbacks.delete(id);
    };
  globalThis.setInterval = function (callback, delay) { var id = nextId++;
    function tick() { callback();
    if (callbacks.has(id)) __schedule(id, Math.max(16, Number(delay) || 0));
    } callbacks.set(id, tick);
    __schedule(id, Math.max(16, Number(delay) || 0));
    return id;
    };
  globalThis.clearInterval = globalThis.clearTimeout;
  globalThis.requestAnimationFrame = function (callback) {
      return setTimeout(function () { callback(Date.now());
    }, 16);
    };
  globalThis.cancelAnimationFrame = globalThis.clearTimeout;
  globalThis.__dispatch = function (id, event) {
    var callback = callbacks.get(id);
    if (!callback) return;
    event.target = wrap(event.target);
    event.currentTarget = wrap(event.currentTarget);
    event.preventDefault = function () {};
    event.stopPropagation = function () {};
    callback(event);
  };
  globalThis.__reply = function (id, data, error) {
    var request = requests.get(id);
    var failure;
    if (!request) return;
    requests.delete(id);
    if (error) {
      failure = new Error(error);
      failure.name = 'WidgetRequestError';
      failure.code = error;
      request.reject(failure);
    } else request.resolve({ result: data || null });
  };
  globalThis.__update = function (state) {
    var oldChat = TelegramWidget.chatData;
    var oldPublic = TelegramWidget.publicData;
 var oldTheme = JSON.stringify(TelegramWidget.themeParams);
 var key;
    state.chatData = state.chatData || null;
    state.publicData = state.publicData || null;
    Object.assign(TelegramWidget, state);
    TelegramWidget.wallet = state.walletAvailable ? localWallet : null;
    TelegramWidget.themeParams = Object.freeze(TelegramWidget.themeParams);
    globalThis.devicePixelRatio=state.devicePixelRatio || 1;
    globalThis.innerWidth=state.viewportWidth || 300;
    globalThis.innerHeight=state.viewportHeight || 150;
    navigator.language=state.language || 'en';
    for (key in state.themeParams) {
 document.body.style.setProperty('--tg-theme-'+key.replace(/_/g,'-'),state.themeParams[key]);
 }
    if (oldTheme !== JSON.stringify(state.themeParams)) {
 (events.get('themeChanged') || []).forEach(function (fn) { fn(); });
 }
    if (oldChat !== state.chatData) (events.get('chatDataChanged') || []).forEach(function (fn) { fn();
    });
    if (oldPublic !== state.publicData) (events.get('publicDataChanged') || []).forEach(function (fn) { fn();
    });
  };
  function walletRequest(action,payload,data) {
    var id = nextId++;
    var error;
    if(typeof data!=='string' || !data.length
      || encodeURIComponent(data).replace(/%[0-9A-F]{2}/g,'x').length>64) throw new TypeError('Invalid query data');
    if(requests.size) {
      error=new Error('Another request is pending');
      error.name='WidgetRequestError';
      error.code='BUSY';
      return Promise.reject(error);
    }
    return new Promise(function(resolve,reject) {
      requests.set(id,{resolve:resolve,reject:reject});
      __wallet(id,action,JSON.stringify(payload),data);
    });
  }
  localWallet = {
    sendTransaction:function(transaction,data) { return walletRequest('send_transaction',transaction,data); },
    signData:function(payload,data) { return walletRequest('sign_data',payload,data); }
  };
  globalThis.TelegramWidget = {
    chatData: null,
    publicData: null,
    themeParams: {},
    colorScheme: 'light',
    viewer: null,
    wallet: null,
    isPreview: false,
    isForward: false,
    chatType: 'private',
    contentSafeAreaInset: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0, cornerLeft: 0, cornerRight: 0 }),
    HapticFeedback: {
      impactOccurred: function () { return this; },
      notificationOccurred: function () { return this; },
      selectionChanged: function () { return this; }
    },
    ready: function () {},
    watchPublicData: function () { __watch(true);
    },
    unwatchPublicData: function () { __watch(false);
    },
    setResizeAnchor: function () {},
    onEvent: function (name, callback) { var list = events.get(name) || [];
    list.push(callback);
    events.set(name, list);
    },
    offEvent: function (name, callback) { events.set(name, (events.get(name) || []).filter(function (fn) {
      return fn !== callback;
    }));
    },
    request: function (data,options) {
      var id = nextId++;
      var error;
      if (typeof data !== 'string' || !data.length
        || encodeURIComponent(data).replace(/%[0-9A-F]{2}/g,'x').length > 64) {
        throw new TypeError('Request data must contain 1-64 UTF-8 bytes');
      }
      if (requests.size) {
        error = new Error('Another request is pending');
        error.name = 'WidgetRequestError';
        error.code = 'BUSY';
        return Promise.reject(error);
      }
      if(options && options.wallet) return walletRequest('card',{},data);
      return new Promise(function (resolve,reject) {
        requests.set(id,{resolve:resolve,reject:reject});
        __request(id,data);
      });
    },
    copyText: function (value) { __copy(String(value)); },
    openLink: function (url) { __open(String(url));
    },
    openTelegramLink: function (url) { __open(String(url));
    }
  };
})();
`;
