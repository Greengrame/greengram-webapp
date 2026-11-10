const MAX_CANVAS_PIXELS = 2048 * 2048;
const MAX_CANVAS_COMMANDS = 4000;
const MAX_CANVAS_RESOURCES = 256;
const DRAW_METHODS = new Set((
  'beginPath closePath moveTo lineTo bezierCurveTo quadraticCurveTo arc arcTo ellipse rect roundRect '
  + 'clearRect fillRect strokeRect fill stroke clip fillText strokeText measureText save restore '
  + 'translate rotate scale transform setTransform resetTransform getTransform isPointInPath isPointInStroke '
  + 'setLineDash getLineDash drawImage createLinearGradient createRadialGradient'
).split(' '));
const DRAW_PROPERTIES = new Set((
  'fillStyle strokeStyle lineWidth lineCap lineJoin miterLimit lineDashOffset font textAlign textBaseline '
  + 'direction globalAlpha imageSmoothingEnabled imageSmoothingQuality'
).split(' '));

type CanvasCommand = { action: string; id: number; name: string; value: unknown };
type CanvasReference = { _canvasResource?: number; _id?: number };
type CanvasCallable = (...args: unknown[]) => unknown;

export function createWidgetCanvasBridge(nodes: Map<number, Node>) {
  const resources = new Map<number, CanvasGradient | Path2D>();
  const counts = new Map<number, number>();
  const depths = new Map<number, number>();
  const resourceCounts = new Map<number, number>();
  let nextResourceId = 1;

  function addResource(resource: CanvasGradient | Path2D) {
    const id = nextResourceId++;
    if (resources.size >= MAX_CANVAS_RESOURCES) throw new RangeError('Canvas resource limit exceeded');
    resources.set(id, resource);
    return { _canvasResource: id };
  }

  function validatePixels() {
    let pixels = 0;
    let node: Node;
    for (node of nodes.values()) {
      if (node instanceof HTMLCanvasElement) pixels += node.width * node.height;
    }
    if (pixels > MAX_CANVAS_PIXELS) throw new RangeError('Canvas pixel limit exceeded');
  }

  function unwrap(value: unknown): unknown {
    const reference = value && typeof value === 'object' ? value as CanvasReference : undefined;
    if (reference?._canvasResource) return resources.get(reference._canvasResource);
    if (reference?._id) return nodes.get(reference._id);
    return value;
  }

  function execute(command: CanvasCommand): unknown {
    const node = nodes.get(command.id);
    const args = Array.isArray(command.value) ? command.value.map(unwrap) : [];
    const count = (counts.get(command.id) || 0) + 1;
    const canvas = node instanceof HTMLCanvasElement ? node : undefined;
    let context: CanvasRenderingContext2D | null;
    let result: unknown;
    let resource: CanvasGradient | Path2D | undefined;
    let image: unknown;
    let values: Record<string, unknown>;
    if (command.action === 'canvasPath') {
      result = unwrap(command.value);
      if (typeof result !== 'string' && !(result instanceof Path2D) && result !== undefined) {
        throw new TypeError('Invalid canvas path');
      }
      if (typeof result === 'string' && result.length > 32768) throw new RangeError('Canvas path limit exceeded');
      return addResource(new Path2D(result));
    }
    if (command.action === 'canvasResource') {
      if ((resourceCounts.get(command.id) || 0) >= MAX_CANVAS_COMMANDS) {
        throw new RangeError('Canvas resource command limit exceeded');
      }
      resourceCounts.set(command.id, (resourceCounts.get(command.id) || 0) + 1);
      resource = resources.get(command.id);
      if (resource instanceof CanvasGradient && command.name === 'addColorStop') {
        resource.addColorStop(Number(args[0]), String(args[1]));
      } else if (resource instanceof Path2D && DRAW_METHODS.has(command.name)) {
        values = resource as unknown as Record<string, unknown>;
        if (typeof values[command.name] === 'function') (values[command.name] as CanvasCallable).apply(resource, args);
      }
      return undefined;
    }
    if (!canvas) return undefined;
    validatePixels();
    if (count > MAX_CANVAS_COMMANDS) throw new RangeError('Canvas command limit exceeded');
    counts.set(command.id, count);
    context = canvas.getContext('2d');
    if (!context) return undefined;
    values = context as unknown as Record<string, unknown>;
    if (command.action === 'canvasGet') {
      result = DRAW_PROPERTIES.has(command.name) ? values[command.name] : undefined;
      return result instanceof CanvasGradient ? addResource(result) : result;
    }
    if (command.action === 'canvasSet') {
      if (DRAW_PROPERTIES.has(command.name)) values[command.name] = unwrap(command.value);
      return undefined;
    }
    if (!DRAW_METHODS.has(command.name)) return undefined;
    if (command.name === 'save') {
      if ((depths.get(command.id) || 0) >= 64) throw new RangeError('Canvas state limit exceeded');
      depths.set(command.id, (depths.get(command.id) || 0) + 1);
    }
    if (command.name === 'restore') depths.set(command.id, Math.max(0, (depths.get(command.id) || 0) - 1));
    if (command.name === 'drawImage') {
      image = args[0];
      if (!(image instanceof HTMLCanvasElement) && !(image instanceof HTMLImageElement)) return undefined;
      if (image instanceof HTMLImageElement && (!image.src.startsWith('data:')
        || image.naturalWidth > 1024 || image.naturalHeight > 1024)) return undefined;
    }
    result = (values[command.name] as CanvasCallable).apply(context, args);
    if (result instanceof CanvasGradient) return addResource(result);
    if (result instanceof TextMetrics) {
      return {
        width: result.width, actualBoundingBoxLeft: result.actualBoundingBoxLeft,
        actualBoundingBoxRight: result.actualBoundingBoxRight, actualBoundingBoxAscent: result.actualBoundingBoxAscent,
        actualBoundingBoxDescent: result.actualBoundingBoxDescent,
      };
    }
    if (result instanceof DOMMatrix) {
      return { a: result.a, b: result.b, c: result.c, d: result.d, e: result.e, f: result.f };
    }
    return result;
  }

  return { execute, validatePixels, reset: () => counts.clear() };
}
