"use client";

const liquidGlassToastFilterId = "icedr-liquid-glass-toast-filter";

type LiquidGlassMap = {
  href: string;
  scale: number;
  viewBoxHeight: number;
  viewBoxWidth: number;
};

type LiquidGlassFilterProps = {
  height?: number;
  id?: string;
  radius?: number;
  width?: number;
};

const defaultMapSize = {
  height: 56,
  width: 360,
};
const maxCachedMaps = 18;
const cachedToastMaps = new Map<string, LiquidGlassMap>();

export function LiquidGlassFilter({
  height = defaultMapSize.height,
  id = liquidGlassToastFilterId,
  radius = 8,
  width = defaultMapSize.width,
}: LiquidGlassFilterProps) {
  const map = getLiquidGlassMap(width, height, radius);

  return (
    <svg aria-hidden="true" className="icedr-liquid-glass-filter" focusable="false">
      <defs>
        <filter
          id={id}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
          x="0"
          y="0"
          width={map?.viewBoxWidth ?? width}
          height={map?.viewBoxHeight ?? height}
        >
          {map ? (
            <feImage
              href={map.href}
              preserveAspectRatio="none"
              result="displacementMap"
              width={map.viewBoxWidth}
              height={map.viewBoxHeight}
            />
          ) : null}
          <feDisplacementMap
            in="SourceGraphic"
            in2="displacementMap"
            scale={map?.scale ?? 0}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

function getLiquidGlassMap(width: number, height: number, radius: number) {
  if (typeof document === "undefined") return null;
  const viewBoxWidth = clamp(Math.round(width), 180, 520);
  const viewBoxHeight = clamp(Math.round(height), 44, 96);
  const viewBoxRadius = clamp(Math.round(radius), 4, Math.round(viewBoxHeight / 2));
  const cacheKey = `${viewBoxWidth}:${viewBoxHeight}:${viewBoxRadius}`;
  const cachedMap = cachedToastMaps.get(cacheKey);
  if (cachedMap) return cachedMap;

  const map = createLiquidGlassMap(viewBoxWidth, viewBoxHeight, viewBoxRadius);
  cachedToastMaps.set(cacheKey, map);
  if (cachedToastMaps.size > maxCachedMaps) {
    const oldestKey = cachedToastMaps.keys().next().value;
    if (oldestKey) cachedToastMaps.delete(oldestKey);
  }
  return map;
}

function createLiquidGlassMap(viewBoxWidth: number, viewBoxHeight: number, radius: number): LiquidGlassMap {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return {
      href: "",
      scale: 0,
      viewBoxHeight,
      viewBoxWidth,
    };
  }

  const canvasDpi = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);
  const width = Math.max(1, Math.round(viewBoxWidth * canvasDpi));
  const height = Math.max(1, Math.round(viewBoxHeight * canvasDpi));

  canvas.width = width;
  canvas.height = height;

  const data = new Uint8ClampedArray(width * height * 4);
  const rawValues: number[] = [];
  let maxScale = 0;
  const aspect = viewBoxWidth / viewBoxHeight;
  const radiusRatio = radius / viewBoxHeight;

  for (let index = 0; index < data.length; index += 4) {
    const x = (index / 4) % width;
    const y = Math.floor(index / 4 / width);
    const uv = {
      x: x / width,
      y: y / height,
    };
    const pos = liquidGlassFragment(uv, aspect, radiusRatio);
    const dx = pos.x * width - x;
    const dy = pos.y * height - y;
    maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
    rawValues.push(dx, dy);
  }

  const scale = Math.max(1, maxScale * 0.92);
  let valueIndex = 0;
  for (let index = 0; index < data.length; index += 4) {
    const red = rawValues[valueIndex++] / scale + 0.5;
    const green = rawValues[valueIndex++] / scale + 0.5;
    data[index] = Math.max(0, Math.min(255, red * 255));
    data[index + 1] = Math.max(0, Math.min(255, green * 255));
    data[index + 2] = 0;
    data[index + 3] = 255;
  }

  context.putImageData(new ImageData(data, width, height), 0, 0);
  return {
    href: canvas.toDataURL("image/png"),
    scale: (scale / canvasDpi) * 1.28,
    viewBoxHeight,
    viewBoxWidth,
  };
}

function liquidGlassFragment(uv: { x: number; y: number }, aspect: number, radiusRatio: number) {
  const verticalScale = Math.max(1, aspect * 0.2);
  const x = uv.x - 0.5;
  const y = (uv.y - 0.5) / verticalScale;
  const radius = clamp(radiusRatio * 1.8, 0.12, 0.28);
  const distanceToEdge = roundedRectSDF(x, y, 0.47, 0.25, radius);
  const displacement = smoothStep(0.52, -0.06, distanceToEdge - 0.025);
  const lens = smoothStep(0, 1, displacement);
  const edgeLens = 1 - smoothStep(0.004, 0.1, Math.abs(distanceToEdge));
  const innerLens = 1 - smoothStep(0.05, 0.54, Math.hypot(x * 1.1, y * 2.7));
  const cornerLens = 1 - smoothStep(
    0,
    0.22,
    Math.min(
      Math.hypot(uv.x - 0.04, uv.y - 0.08),
      Math.hypot(uv.x - 0.96, uv.y - 0.08),
      Math.hypot(uv.x - 0.04, uv.y - 0.92),
      Math.hypot(uv.x - 0.96, uv.y - 0.92),
    ),
  );
  const liquidWave =
    Math.sin((uv.x * 2.15 + uv.y * 0.72) * Math.PI) * edgeLens * 0.03 +
    Math.cos((uv.x * 0.74 - uv.y * 2.48) * Math.PI) * innerLens * 0.009;
  const edgePullX = Math.sign(x || 1) * edgeLens * 0.096;
  const edgePullY = Math.sign(y || 1) * edgeLens * 0.058;
  const cornerPull = cornerLens * 0.044;

  return {
    x: x * (0.965 + lens * 0.105) + edgePullX + liquidWave + Math.sign(x || 1) * cornerPull + 0.5,
    y:
      (y * (0.965 + lens * 0.1) +
        edgePullY -
        liquidWave * 0.32 +
        Math.sign(y || 1) * cornerPull * 0.54) *
        verticalScale +
      0.5,
  };
}

function smoothStep(a: number, b: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundedRectSDF(x: number, y: number, width: number, height: number, radius: number) {
  const qx = Math.abs(x) - width + radius;
  const qy = Math.abs(y) - height + radius;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
}
