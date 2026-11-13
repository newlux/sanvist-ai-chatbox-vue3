import {
  defaultAudioRippleAppearance,
  type RippleSettings,
  type RipplePalette,
  type RippleSignal,
  type RippleSize,
  type RippleImages,
} from './audio-ripple-model';

type Surface = HTMLCanvasElement | OffscreenCanvas;
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const fitBuffer = (buffer: Float64Array<ArrayBuffer>, length: number) =>
  buffer.length >= length && buffer.length <= length * 2 ? buffer : new Float64Array(Math.ceil(length * 1.25));

/** The same pixel algorithm runs on either canvas; scheduling belongs to its host. */
export function createAudioRippleRenderer(
  surface: Surface,
  createSurface: () => Surface,
  initial: RippleSettings,
  initialPalette: RipplePalette,
  { texture, darkTexture, darkInput }: RippleImages
) {
  const context = surface.getContext('2d') as Context | null;
  const field = createSurface();
  const mask = createSurface();
  const fieldContext = field.getContext('2d') as Context | null;
  const maskContext = mask.getContext('2d') as Context | null;
  const inputReference = createSurface();
  const inputReferenceContext = inputReference.getContext('2d', { willReadFrequently: true }) as Context | null;
  if (!context || !fieldContext || !maskContext || !inputReferenceContext) throw new Error('Canvas 2D is unavailable');
  let currentSettings = initial;
  let palettes = initialPalette;
  let dark = initialPalette.dark;
  const colors = new Float32Array(initialPalette[initial.variant]);
  let reducedMotion = false;
  let signal: RippleSignal | null = null;
  const empty = new Float32Array(0);
  let inputReferencePixels: ImageData | undefined;
  // Figma 2431:685741, including its three independently blurred colour layers.
  // Cache only its colours at field resolution. Both themes use the same
  // frequency envelope and falloff for the configured input widths. Colour
  // strength belongs to the theme, independently of that shared geometry.
  const rasterizeInput = () => {
    if (!darkInput || !field.width) return;
    inputReference.width = field.width;
    inputReference.height = 270;
    inputReferenceContext.drawImage(
      darkInput,
      (-302 / 1920) * field.width,
      805.41 / 4,
      (2525.15 / 1920) * field.width,
      690.492 / 4
    );
    inputReferencePixels = inputReferenceContext.getImageData(0, 0, field.width, 270);
    // The shared sound envelope supplies alpha. Extend the outermost stable
    // colour through the SVG's transparent padding; transparent black RGB
    // would otherwise make a hard dark rim when the three layers compress.
    const pixels = inputReferencePixels.data;
    for (let x = 0; x < field.width; x++) {
      let outer = ((inputReference.height - 1) * field.width + x) * 4;
      for (let y = inputReference.height - 1; y >= 0; y--) {
        const at = (y * field.width + x) * 4;
        if (pixels[at + 3]! >= 16) outer = at;
        else for (let channel = 0; channel < 3; channel++) pixels[at + channel] = pixels[outer + channel]!;
      }
    }
  };
  let width = 0,
    height = 0,
    ratio = 1,
    previous = 0,
    time = 0,
    idleTime = 0,
    colorPhase = 0;
  let image: ImageData, alpha: ImageData;
  let inputBottom = new Float32Array(0);
  let leftDistance = new Float64Array(0),
    rightDistance = new Float64Array(0),
    topDistance = new Float64Array(0),
    bottomDistance = new Float64Array(0),
    perimeterPositions = new Float64Array(0);
  // These values depend on the arc's geometry, not its moving audio energy.
  // Keep doubles so cached operations retain the same pixel rounding.
  let geometry = new Float64Array(0);
  let geometryStart = NaN,
    geometryLength = NaN,
    geometryTaper = NaN;
  let colorPositions = new Float64Array(0);
  let interiorDepth = new Float64Array(0);
  let colorStart = NaN,
    colorLength = NaN;
  const edges = Array.from({ length: 4 }, () => ({
    opacity: new Float32Array(0),
    glowReach: new Float32Array(0),
    glowOpacity: new Float32Array(0),
    coreOpacity: new Float32Array(0),
    mistOpacity: new Float32Array(0),
    mistReach: new Float32Array(0),
    red: new Float32Array(0),
    green: new Float32Array(0),
    blue: new Float32Array(0),
  }));
  // Distance along the rectangular perimeter, starting at the left midpoint
  // and travelling via the bottom, right, top, then back to the left.
  const perimeterAt = (x: number, y: number) => {
    const dx = x - width / 2,
      dy = y - height / 2;
    const scale = Math.max(Math.abs(dx) / (width / 2), Math.abs(dy) / (height / 2), 1e-9);
    const px = width / 2 + dx / scale,
      py = height / 2 + dy / scale;
    if (Math.abs(dx) / width > Math.abs(dy) / height)
      return dx < 0
        ? py >= height / 2
          ? py - height / 2
          : 2 * (width + height) + py - height / 2
        : height / 2 + width + height - py;
    return dy > 0 ? height / 2 + px : height * 1.5 + width * 2 - px;
  };
  const resize = ({ width: nextWidth, height: nextHeight, ratio: nextRatio }: RippleSize) => {
    if (image && width === nextWidth && height === nextHeight && ratio === nextRatio) return;
    width = nextWidth;
    height = nextHeight;
    ratio = nextRatio;
    surface.width = Math.round(width * ratio);
    surface.height = Math.round(height * ratio);
    // The smooth colour field needs fewer pixels; the Figma texture stays at display resolution.
    field.width = mask.width = Math.max(1, Math.ceil(width / 4));
    field.height = mask.height = Math.max(1, Math.ceil(height / 4));
    rasterizeInput();
    image = fieldContext.createImageData(field.width, field.height);
    alpha = maskContext.createImageData(field.width, field.height);
    inputBottom = new Float32Array(field.width);
    // Pixel distances only change on resize, not with sound or glow motion.
    leftDistance = new Float64Array(field.width);
    rightDistance = new Float64Array(field.width);
    topDistance = new Float64Array(field.height);
    bottomDistance = new Float64Array(field.height);
    const pixels = field.width * field.height;
    // Modest spare capacity avoids reallocating large caches on every drag
    // tick; shrinking by half releases excess space. Output geometry remains lazy.
    perimeterPositions = fitBuffer(perimeterPositions, pixels);
    if (geometry.length > pixels * 12) geometry = new Float64Array(0);
    colorPositions = fitBuffer(colorPositions, pixels);
    interiorDepth = fitBuffer(interiorDepth, pixels);
    geometryStart = geometryLength = geometryTaper = colorStart = colorLength = NaN;
    for (let x = 0; x < field.width; x++) {
      const cx = ((x + 0.5) / field.width) * width;
      leftDistance[x] = Math.max(0.01, cx) ** 4;
      rightDistance[x] = Math.max(0.01, width - cx) ** 4;
    }
    for (let y = 0; y < field.height; y++) {
      const cy = ((y + 0.5) / field.height) * height;
      topDistance[y] = Math.max(0.01, cy) ** 4;
      bottomDistance[y] = Math.max(0.01, height - cy) ** 4;
      // Keep a generous eight-field-pixel apron around any possibly visible
      // mask pixel. Colour interpolation therefore never reaches skipped data.
      const nearTop = Math.max(0.01, ((Math.max(0, y - 8) + 0.5) / field.height) * height) ** 4;
      const nearBottom =
        Math.max(0.01, height - ((Math.min(field.height - 1, y + 8) + 0.5) / field.height) * height) ** 4;
      for (let x = 0; x < field.width; x++) {
        perimeterPositions[y * field.width + x] = perimeterAt(((x + 0.5) / field.width) * width, cy);
        // All arc opacities are at most one. Using all four edges and their
        // nearest apron distances is a lower bound for every covered depth.
        interiorDepth[y * field.width + x] =
          1 /
          Math.sqrt(
            Math.sqrt(
              1 / leftDistance[Math.max(0, x - 8)]! +
                1 / rightDistance[Math.min(field.width - 1, x + 8)]! +
                1 / nearTop +
                1 / nearBottom
            )
          );
      }
    }
    edges.forEach((edge, index) => {
      const size = index < 2 ? field.width : field.height;
      edge.opacity = new Float32Array(size);
      edge.glowReach = new Float32Array(size);
      edge.glowOpacity = new Float32Array(size);
      edge.coreOpacity = new Float32Array(size);
      edge.mistOpacity = new Float32Array(size);
      edge.mistReach = new Float32Array(size);
      edge.red = new Float32Array(size);
      edge.green = new Float32Array(size);
      edge.blue = new Float32Array(size);
    });
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  const bands = new Float32Array(32),
    targets = new Float32Array(32),
    powers = new Float32Array(32),
    ranges = new Uint32Array(64);
  const filterWeights: Float32Array[] = [];
  let spectrum = new Float32Array(0),
    samples = new Float32Array(0),
    analysedSource: number | undefined,
    analysedRate = 0,
    analysedSize = 0,
    analysedMin = NaN,
    analysedMax = NaN;
  let sides = initial.variant === 'output' ? 1 : 0;
  let voice = 0,
    intensity = initial.variant === 'input' ? 0.5 : 1;
  const initialInput = { ...defaultAudioRippleAppearance.input, ...initial.inputAppearance };
  const glow = { ...defaultAudioRippleAppearance.output, ...initial.outputAppearance };
  // Fixed visual treatment shared by SANI and the reference preview.
  const glowSettings = {
    glowCount: 4,
    glowSize: 0.105,
    glowJitterSpeed: 0.8,
    glowAudioMotion: 0.8,
    glowVariation: 0.28,
  };
  // Audio moves and reshapes each soft edge region within its own frequency range.
  // These are visual seeds, never audio or device state.
  let vibrationTime = 0;
  const patches = Array.from({ length: glowSettings.glowCount }, (_, index) => ({
    offset: 0.5 + 0.04 * Math.sin(index * 2.4),
    scale: 0.5 + 0.5 * Math.sin(index * 1.9 + 0.7),
    phase: index * 2.4,
    position: (index + 0.5 + 0.04 * Math.sin(index * 2.4)) / glowSettings.glowCount,
    pulse: 1,
    extent: 1,
    energy: 0,
    mistEnergy: 0,
    color: new Float32Array(3),
  }));
  const cornerColor = new Float32Array(3);
  let inputBase = initialInput.baseWidth,
    inputMaximum = initialInput.maxWidth,
    idleAmplitude = initialInput.idleAmplitude,
    idleLoudness = 0;
  let startAngle = glow.startAngle;
  let endAngle = glow.endAngle;
  // 四色沿弧线等分（起点第 1 色 → 终点第 4 色）；最后一段停在自身，不回绕到第 1 色，
  // 否则「从左到右」的右端会突然变回左端的颜色。弧线两端正好落在顶部缺口，不需要闭合。
  const stops = [0, 0.25, 0.5, 0.75, 1];
  const colour = (position: number, offset: number, destination: Uint8ClampedArray | Float32Array = image.data) => {
    const at = ((position % 1) + 1) % 1;
    const stop = at < stops[1]! ? 0 : at < stops[2]! ? 1 : at < stops[3]! ? 2 : 3;
    const blend = (at - stops[stop]!) / (stops[stop + 1]! - stops[stop]!);
    const next = stop < 3 ? stop + 1 : 3;
    for (let channel = 0; channel < 3; channel++)
      destination[offset + channel] =
        colors[stop * 4 + channel]! * (1 - blend) + colors[next * 4 + channel]! * blend;
  };
  const envelope = (position: number, minimum: number, limit: number, closed = false, input = false) => {
    const index = closed ? position * 32 : Math.max(0, Math.min(31, position * 31));
    let energy = 0;
    // Fixed frequency positions, with a broad spatial envelope instead of drifting peaks.
    const spread = 4.8;
    for (let band = 0; band < 32; band++) {
      const distance = Math.abs(band - index);
      energy = Math.max(
        energy,
        bands[band]! * Math.exp(-0.5 * ((closed ? Math.min(distance, 32 - distance) : distance) / spread) ** 2)
      );
    }
    if (input) {
      // A small visual loudness envelope breathes even without a live analyser.
      // Real speech takes over; ambient motion never adds to its peak height.
      const ambient = idleLoudness * (0.55 + 0.45 * (0.5 + 0.5 * Math.sin(position * 8 + idleTime * 1.4)));
      energy = Math.max(energy, ambient * (1 - voice));
    }
    const idle = input
      ? 0
      : (Math.sin(position * (closed ? Math.PI * 2 : 8) + idleTime * 0.45) + 1) * 0.015 * (1 - energy);
    return Math.max(0.001, minimum * (1 - idle) + (limit - minimum) * energy);
  };
  const perimeterAtAngle = (angle: number) => {
    const turns = (angle + 180) / 360;
    const phase = turns - Math.floor(turns);
    if (phase < 1e-9) return Math.floor(turns) * 2 * (width + height);
    const radians = ((phase * 360 - 180) * Math.PI) / 180;
    return (
      perimeterAt(width / 2 + Math.cos(radians), height / 2 - Math.sin(radians)) +
      Math.floor(turns) * 2 * (width + height)
    );
  };
  const draw = (now: number) => {
    if (!width || !height || now - previous < 1000 / 30) return false;
    const dt = previous ? Math.min((now - previous) / 1000, 0.1) : 1 / 30;
    previous = now;
    const current = currentSettings;
    const settings = { ...defaultAudioRippleAppearance.input, ...current.inputAppearance };
    const outputSettings = { ...defaultAudioRippleAppearance.output, ...current.outputAppearance };
    const textureSettings = { ...defaultAudioRippleAppearance.texture, ...current.textureAppearance };
    const speed = Math.max(0.25, current.variant === 'output' ? outputSettings.speed : settings.speed);
    const motionScale = current.preview === 'static' ? 0 : reducedMotion ? 0.12 : 1;
    time += dt * speed * motionScale;
    idleTime += dt * Math.max(0.1, current.idleSpeed) * motionScale;
    const ease = 1 - Math.exp(-dt / 0.24);
    const targetStart = outputSettings.startAngle;
    const targetEnd = outputSettings.endAngle;
    startAngle += (targetStart - startAngle) * ease;
    endAngle += (targetEnd - endAngle) * ease;
    if (Math.abs(targetStart - startAngle) < 0.001) startAngle = targetStart;
    if (Math.abs(targetEnd - endAngle) < 0.001) endAngle = targetEnd;
    inputBase += (settings.baseWidth - inputBase) * ease;
    inputMaximum += (settings.maxWidth - inputMaximum) * ease;
    idleAmplitude += (settings.idleAmplitude - idleAmplitude) * ease;
    for (const key of ['edgeOpacity', 'edgeWidth', 'haloOpacity', 'haloWidth', 'travel', 'deformation'] as const) {
      glow[key] += (outputSettings[key] - glow[key]) * ease;
      // Zero disables that layer; an asymptotic positive width must not keep it alive.
      if (Math.abs(outputSettings[key] - glow[key]) < 0.001) glow[key] = outputSettings[key];
    }
    colorPhase = (colorPhase + ((dt * Math.max(0, outputSettings.colorSpeed)) / 60) * motionScale * sides) % 1;
    const targetSides = current.variant === 'output' ? 1 : 0;
    sides = reducedMotion ? targetSides : sides + (targetSides - sides) * (1 - Math.exp((-dt * speed) / 0.35));
    const palette = palettes[current.variant];
    for (let i = 0; i < 16; i++) colors[i] = colors[i]! + (palette[i]! - colors[i]!) * ease;
    const lower =
      current.variant === 'output' ? 50 : (settings.minFrequency ?? defaultAudioRippleAppearance.input.minFrequency);
    const upper = Math.min(
      current.variant === 'output' ? 8000 : (settings.maxFrequency ?? defaultAudioRippleAppearance.input.maxFrequency),
      signal?.sampleRate ? signal.sampleRate / 2 : Infinity
    );
    const analyserChanged =
      signal?.id !== analysedSource || signal?.sampleRate !== analysedRate || signal?.fftSize !== analysedSize;
    spectrum = signal?.spectrum ?? empty;
    samples = signal?.samples ?? empty;
    if (signal && (analyserChanged || lower !== analysedMin || upper !== analysedMax)) {
      analysedSource = signal.id;
      analysedRate = signal.sampleRate;
      analysedSize = signal.fftSize;
      analysedMin = lower;
      analysedMax = upper;
      ranges.fill(0);
      if (upper > lower) {
        const binHz = signal.sampleRate / signal.fftSize;
        // Uniform ERB-rate centres: the common factor in the Hz→ERB formula cancels.
        const lowErb = Math.log1p(0.00437 * lower);
        const step = (Math.log1p(0.00437 * upper) - lowErb) / 31;
        for (let i = 0; i < 32; i++) {
          const lowHz = Math.expm1(lowErb + Math.max(0, i - 1) * step) / 0.00437;
          const highHz = Math.expm1(lowErb + Math.min(31, i + 1) * step) / 0.00437;
          const start = Math.max(1, Math.floor(lowHz / binHz));
          const end = Math.min(spectrum.length, Math.ceil(highHz / binHz) + 1);
          ranges[i * 2] = start;
          ranges[i * 2 + 1] = end;
          const weights = new Float32Array(end - start);
          for (let bin = start; bin < end; bin++) {
            const hz = bin * binHz;
            const at = (Math.log1p(0.00437 * hz) - lowErb) / step;
            const weight = hz < lower || hz > upper ? 0 : Math.max(0, 1 - Math.abs(at - i));
            weights[bin - start] = weight;
          }
          filterWeights[i] = weights;
        }
      }
    }
    targets.fill(0);
    let voiceTarget = 0;
    if (current.preview === 'static') {
      voiceTarget = 0.9;
      targets.fill(voiceTarget);
    } else if (current.preview === 'speech') {
      // Illustrative phrase and syllable envelopes, not measured audio. Reuse
      // the same bands, smoothing, colour field and appearance as real sound.
      const phrase = (Math.sin(time * 1.7) + 1) / 2;
      const syllable = ((Math.sin(time * 10 + Math.sin(time * 2.3)) + 1) / 2) ** 0.65;
      voiceTarget = 0.08 + 0.9 * phrase * syllable;
      for (let i = 0; i < 32; i++) {
        // Keep the simulated frequencies fixed in Hz while the visible range changes.
        const lowErb = Math.log1p(0.00437 * 50);
        const at =
          (Math.log1p(0.00437 * lower) +
            ((Math.log1p(0.00437 * upper) - Math.log1p(0.00437 * lower)) * i) / 31 -
            lowErb) /
          (Math.log1p(0.00437 * 8000) - lowErb);
        const low = (0.35 + 0.3 * Math.sin(time * 2.1) ** 2) * Math.exp(-0.5 * (at / 0.22) ** 2);
        const vowel = 0.85 * Math.exp(-0.5 * ((at - 0.42 - 0.06 * Math.sin(time * 1.3)) / 0.2) ** 2);
        const consonant =
          (0.15 + 0.65 * Math.max(0, Math.sin(time * 5.3 + 0.7)) ** 4) * Math.exp(-0.5 * ((at - 0.9) / 0.19) ** 2);
        targets[i] = voiceTarget * Math.min(1, low + vowel + consonant);
      }
    } else if (!current.preview && signal?.running) {
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      let rms = Math.sqrt(sum / samples.length);
      let strongest = 0;
      {
        let selectedPower = 0,
          fullPower = 0;
        for (const db of spectrum) if (Number.isFinite(db)) fullPower += 10 ** (db / 10);
        for (let i = 0; i < 32; i++) {
          let power = 0;
          const start = ranges[i * 2]!;
          for (let bin = start; bin < ranges[i * 2 + 1]!; bin++)
            if (Number.isFinite(spectrum[bin])) power += 10 ** (spectrum[bin]! / 10) * filterWeights[i]![bin - start]!;
          // Overlapping triangles partition real spectral power across adjacent auditory bands.
          powers[i] = power;
          selectedPower += power;
          strongest = Math.max(strongest, powers[i]!);
        }
        // Both sources exclude outside-range energy instead of amplifying spectral leakage.
        rms *= Math.sqrt(fullPower > 0 ? Math.min(1, selectedPower / fullPower) : 0);
      }
      const level = (1 - Math.exp(-Math.max(0, rms - 0.0025) * 65)) ** 0.45;
      voiceTarget = level;
      if (strongest > 1e-14) {
        for (let i = 0; i < 32; i++) {
          // A bounded dB display range retains weak real harmonics and consonants.
          const relativeDb = powers[i]! > 0 ? 10 * Math.log10(powers[i]! / strongest) : -Infinity;
          targets[i] = level * Math.max(0, Math.min(1, (relativeDb + 60) / 60)) ** 0.7;
        }
      }
    }
    for (let i = 0; i < 32; i++)
      bands[i] =
        bands[i]! + (targets[i]! - bands[i]!) * (1 - Math.exp((-dt * speed) / (targets[i]! > bands[i]! ? 0.08 : 0.3)));
    voice += (voiceTarget - voice) * (1 - Math.exp((-dt * speed) / (voiceTarget > voice ? 0.08 : 0.3)));
    idleLoudness =
      idleAmplitude * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(idleTime * 2.4 + 0.3 * Math.sin(idleTime * 0.9))));
    const targetIntensity =
      current.variant === 'input'
        ? 0.5 + 0.5 * Math.max(voice, idleLoudness * (1 - voice))
        : current.variant === 'error'
          ? 1
          : intensity;
    intensity += (targetIntensity - intensity) * (1 - Math.exp((-dt * speed) / 0.12));
    const perimeter = 2 * (width + height);
    const start = perimeterAtAngle(startAngle);
    const length = Math.max(0, Math.min(perimeter, perimeterAtAngle(endAngle + 360) - start));
    const closed = length >= perimeter - 0.001;
    if (sides > 0.0001) {
      vibrationTime +=
        dt * speed * glowSettings.glowJitterSpeed * voice * (0.5 + voice * glowSettings.glowAudioMotion) * motionScale;
      for (let i = 0; i < patches.length; i++) {
        const patch = patches[i]!;
        let energy = 0,
          weight = 0,
          moment = 0;
        const first = Math.floor((i * 32) / glowSettings.glowCount);
        const last = Math.floor(((i + 1) * 32) / glowSettings.glowCount);
        for (let band = first; band < last; band++) {
          const value = bands[band]!;
          energy = Math.max(energy, value);
          weight += value;
          moment += value * ((band - first) / Math.max(1, last - first - 1) - 0.5);
        }
        const travel =
          motionScale *
          energy *
          glow.travel *
          (0.6 * Math.sin(vibrationTime * 3.2 + patch.phase) +
            0.2 * Math.sin(vibrationTime * 6.3 + patch.phase * 1.7) +
            (weight > 0 ? (0.5 * moment) / weight : 0));
        const position = Math.max(0.04, Math.min(0.96, (i + patch.offset + travel) / glowSettings.glowCount));
        patch.position += (position - patch.position) * (1 - Math.exp((-dt * speed) / 0.1));
        patch.pulse =
          1 +
          motionScale *
            energy *
            glow.deformation *
            (0.77 * Math.sin(vibrationTime * 5 + patch.phase) + 0.23 * Math.sin(vibrationTime * 8.3 + patch.phase * 2));
        patch.extent = 1 + motionScale * energy * glow.deformation * 0.55 * Math.sin(vibrationTime * 3.7 + patch.phase);
        patch.energy += (energy - patch.energy) * (1 - Math.exp((-dt * speed) / (energy > patch.energy ? 0.06 : 0.24)));
        patch.mistEnergy +=
          (energy - patch.mistEnergy) * (1 - Math.exp((-dt * speed) / (energy > patch.mistEnergy ? 0.2 : 0.55)));
        colour(stops[i % 4]! - colorPhase, 0, patch.color);
      }
    }
    // Give each open end the same room to fade as the field has to extend inward.
    const taperWidth = Math.min(Math.max(glow.edgeWidth, glow.haloWidth) * 3, (perimeter - length) / 2, length / 2);
    // Moving frequency regions can leave a turn between them. Keep the same
    // field filled around covered corners using its existing audio envelopes.
    const corners = [height / 2, height / 2 + width, height * 1.5 + width, height * 1.5 + width * 2]
      .map((position) => (((position - start) % perimeter) + perimeter) % perimeter)
      .filter((offset) => closed || (offset > 0 && offset < length));
    const cornerEnergy = Math.max(voice, ...patches.map((patch) => patch.energy));
    const cornerMistEnergy = Math.max(...patches.map((patch) => patch.mistEnergy));
    const cornerSpread = Math.max(1, Math.max(glow.edgeWidth, glow.haloWidth) * 1.25);
    const fillEdge = (edge: (typeof edges)[number], index: number, position: number) => {
      const offset = (((position - start) % perimeter) + perimeter) % perimeter;
      if (length < 0.001 || (!closed && offset > length)) {
        edge.opacity[index] = 0;
        edge.glowOpacity[index] = edge.coreOpacity[index] = edge.mistOpacity[index] = 0;
        return;
      }
      const taper = closed
        ? 1
        : Math.min(1, offset / Math.max(0.001, taperWidth), (length - offset) / Math.max(0.001, taperWidth));
      edge.opacity[index] = taper * taper * (3 - 2 * taper);
      if (sides > 0.0001) {
        let total = 0,
          coreWeight = 0,
          corePeak = 0,
          coreReach = 0,
          mistWeight = 0,
          mistPeak = 0,
          mistReach = 0,
          red = 0,
          green = 0,
          blue = 0;
        for (const patch of patches) {
          if ((glow.edgeWidth === 0 && glow.haloWidth === 0) || (patch.energy < 0.0001 && patch.mistEnergy < 0.0001))
            continue;
          const delta = offset / length - patch.position;
          const distance = Math.abs(closed ? ((((delta + 0.5) % 1) + 1) % 1) - 0.5 : delta) * length;
          const scale = 1 - glowSettings.glowVariation * (1 - patch.scale) * 0.4;
          const spread = Math.max(1, glowSettings.glowSize * length * scale * patch.extent);
          const core = patch.energy * Math.exp(-0.5 * (distance / spread) ** 2);
          const mist = patch.mistEnergy * Math.exp(-0.5 * (distance / (spread * 1.25)) ** 2);
          // Measured reference: a thin exponential edge with a much wider,
          // lower-density tail. There is no filled ellipse or hard outline.
          const near = glow.edgeWidth * patch.pulse * (0.6 + 0.4 * patch.energy);
          const far = glow.haloWidth > 0 ? Math.max(near, glow.haloWidth) * (0.85 + 0.15 * patch.pulse) : 0;
          const colourWeight = core + mist;
          total += colourWeight;
          coreWeight += core;
          corePeak = Math.max(corePeak, core);
          coreReach += core * near;
          mistWeight += mist;
          mistPeak = Math.max(mistPeak, mist);
          mistReach += mist * far;
          red += colourWeight * patch.color[0]!;
          green += colourWeight * patch.color[1]!;
          blue += colourWeight * patch.color[2]!;
        }
        let corner = 0;
        for (const cornerOffset of corners) {
          const distance = Math.abs(offset - cornerOffset);
          corner = Math.max(
            corner,
            Math.exp(-0.5 * ((closed ? Math.min(distance, length - distance) : distance) / cornerSpread) ** 2)
          );
        }
        if (corner > 0.0001 && (glow.edgeWidth > 0 || glow.haloWidth > 0)) {
          const core = corner * cornerEnergy;
          const mist = corner * cornerMistEnergy;
          const near = glow.edgeWidth * (0.6 + 0.4 * cornerEnergy);
          const far = glow.haloWidth > 0 ? Math.max(near, glow.haloWidth) : 0;
          coreWeight += core;
          corePeak = Math.max(corePeak, core);
          coreReach += core * near;
          mistWeight += mist;
          mistPeak = Math.max(mistPeak, mist);
          mistReach += mist * far;
          const colourWeight = core + mist;
          colour(Math.min(offset / Math.max(0.001, length), 0.9999) - colorPhase, 0, cornerColor);
          total += colourWeight;
          red += colourWeight * cornerColor[0]!;
          green += colourWeight * cornerColor[1]!;
          blue += colourWeight * cornerColor[2]!;
        }
        edge.coreOpacity[index] = corePeak;
        edge.glowReach[index] = coreWeight > 0 ? coreReach / coreWeight : 0;
        edge.mistOpacity[index] = mistPeak;
        edge.mistReach[index] = mistWeight > 0 ? mistReach / mistWeight : 0;
        edge.glowOpacity[index] = Math.max(corePeak, mistPeak);
        edge.red[index] = total > 0 ? red / total : 0;
        edge.green[index] = total > 0 ? green / total : 0;
        edge.blue[index] = total > 0 ? blue / total : 0;
      }
    };
    const [bottom, top, left, right] = edges as [
      (typeof edges)[number],
      (typeof edges)[number],
      (typeof edges)[number],
      (typeof edges)[number],
    ];
    const outputVisible = sides > 0.0001;
    const geometryChanged =
      outputVisible && (start !== geometryStart || length !== geometryLength || taperWidth !== geometryTaper);
    if (geometryChanged) {
      geometry = fitBuffer(geometry, field.width * field.height * 6);
      geometryStart = start;
      geometryLength = length;
      geometryTaper = taperWidth;
    }
    if (start !== colorStart || length !== colorLength) {
      colorStart = start;
      colorLength = length;
      for (let pixel = 0; pixel < field.width * field.height; pixel++) {
        const offset =
          ((((perimeterPositions[pixel]! - start - length / 2 + perimeter / 2) % perimeter) + perimeter) % perimeter) -
          perimeter / 2 +
          length / 2;
        // 收在 0.9999：让弧线终点落在第 4 色上，而不是归一化回落到第 1 色
        colorPositions[pixel] = Math.min(offset / Math.max(0.001, length), 0.9999);
      }
    }
    const uniformColor = [4, 8, 12].every(
      (offset) => colors[offset] === colors[0] && colors[offset + 1] === colors[1] && colors[offset + 2] === colors[2]
    );
    for (let x = 0; x < field.width; x++) {
      const u = (x + 0.5) / field.width;
      if (sides < 1) inputBottom[x] = envelope(u, inputBase, inputMaximum, false, true);
      if (outputVisible) {
        fillEdge(bottom, x, height / 2 + u * width);
        fillEdge(top, x, height * 1.5 + width * 2 - u * width);
      }
    }
    if (outputVisible)
      for (let y = 0; y < field.height; y++) {
        const cy = ((y + 0.5) / field.height) * height;
        fillEdge(left, y, cy - height / 2);
        fillEdge(right, y, height * 1.5 + width - cy);
      }
    // The mask is stored as 8-bit alpha. Outside this conservative bound its
    // entire interpolation apron rounds to zero, irrespective of the moving
    // bands or colours. Skip invisible interiors without lowering resolution.
    let maximumReach = 0;
    if (outputVisible)
      for (const edge of edges)
        for (let index = 0; index < edge.glowReach.length; index++)
          maximumReach = Math.max(maximumReach, edge.glowReach[index]!, edge.mistReach[index]!);
    const outputBound =
      outputVisible && glow.edgeOpacity >= 0 && glow.haloOpacity >= 0
        ? sides * maximumReach * Math.max(0, Math.log((glow.edgeOpacity + glow.haloOpacity) * 510))
        : outputVisible
          ? Infinity
          : 0;
    let maximumInput = 0;
    if (sides < 1) for (const value of inputBottom) maximumInput = Math.max(maximumInput, value);
    const layeredInput = dark && current.variant === 'input' && inputReferencePixels;
    // The dark design keeps its ice-white core in both quiet and speech
    // states. Only the height breathes; the light/error treatment retains
    // its original sound-dependent strength.
    const inputStrength = layeredInput ? 1 : 0.48 * intensity;
    const inputBound =
      maximumInput * Math.sqrt(Math.max(0, Math.log(Math.max(0, inputStrength * (1 - sides)) * 510)) / 2);
    for (let y = 0; y < field.height; y++) {
      const cy = ((y + 0.5) / field.height) * height;
      const nearestBottom = height - ((Math.min(field.height - 1, y + 8) + 0.5) / field.height) * height;
      for (let x = 0; x < field.width; x++) {
        const bottomDepth = height - cy;
        const index = (y * field.width + x) * 4;
        if (!geometryChanged && interiorDepth[index / 4]! > outputBound && nearestBottom > inputBound) {
          alpha.data[index + 3] = 0;
          continue;
        }
        // The Figma frame is the speaking reference at 240 CSS px. Quiet
        // input compresses all three colour layers into its smaller envelope.
        const referenceY = layeredInput
          ? Math.max(0, Math.min(269, Math.floor((1080 - (bottomDepth * 240) / inputBottom[x]!) / 4)))
          : 0;
        const referenceIndex = (referenceY * field.width + x) * 4;
        const inputAlpha = sides < 1 ? Math.exp(-2 * (bottomDepth / inputBottom[x]!) ** 2) * inputStrength : 0;
        if (!outputVisible) {
          // Input/error have no perimeter glow. Keep custom palettes and the
          // outgoing palette transition, but avoid all unused edge geometry.
          if (layeredInput) {
            image.data[index] = layeredInput.data[referenceIndex]!;
            image.data[index + 1] = layeredInput.data[referenceIndex + 1]!;
            image.data[index + 2] = layeredInput.data[referenceIndex + 2]!;
          } else if (uniformColor) {
            image.data[index] = colors[0]!;
            image.data[index + 1] = colors[1]!;
            image.data[index + 2] = colors[2]!;
          } else {
            colour(colorPositions[index / 4]! - colorPhase, index);
          }
          image.data[index + 3] = 255;
          alpha.data[index + 3] = inputAlpha * (1 - sides) * 255;
          continue;
        }
        // A smooth distance to the selected boundary, not alpha compositing.
        // Adjacent edges contribute geometry; opacity is evaluated only once.
        // Taper geometry continuously too; dropping an edge's weight at zero
        // opacity would abruptly expose the remaining edges at its endpoint.
        const geometryIndex = (index / 4) * 6;
        if (geometryChanged) {
          const wb = bottom.opacity[x]! / bottomDistance[y]!;
          const wt = top.opacity[x]! / topDistance[y]!;
          const wl = left.opacity[y]! / leftDistance[x]!;
          const wr = right.opacity[y]! / rightDistance[x]!;
          const weight = wb + wt + wl + wr;
          geometry[geometryIndex] = wb;
          geometry[geometryIndex + 1] = wt;
          geometry[geometryIndex + 2] = wl;
          geometry[geometryIndex + 3] = wr;
          geometry[geometryIndex + 4] = weight;
          geometry[geometryIndex + 5] = 1 / Math.sqrt(Math.sqrt(weight));
        }
        const wb = geometry[geometryIndex]!;
        const wt = geometry[geometryIndex + 1]!;
        const wl = geometry[geometryIndex + 2]!;
        const wr = geometry[geometryIndex + 3]!;
        const weight = geometry[geometryIndex + 4]!;
        const depth = geometry[geometryIndex + 5]!;
        const gb = wb * bottom.glowOpacity[x]!,
          gt = wt * top.glowOpacity[x]!,
          gl = wl * left.glowOpacity[y]!,
          gr = wr * right.glowOpacity[y]!;
        const glowWeight = gb + gt + gl + gr;
        const cb = wb * bottom.coreOpacity[x]!,
          ct = wt * top.coreOpacity[x]!,
          cl = wl * left.coreOpacity[y]!,
          cr = wr * right.coreOpacity[y]!;
        const coreWeight = cb + ct + cl + cr;
        const glowReach =
          coreWeight > 0
            ? (cb * bottom.glowReach[x]! +
                ct * top.glowReach[x]! +
                cl * left.glowReach[y]! +
                cr * right.glowReach[y]!) /
              coreWeight
            : 0;
        const mb = wb * bottom.mistOpacity[x]!,
          mt = wt * top.mistOpacity[x]!,
          ml = wl * left.mistOpacity[y]!,
          mr = wr * right.mistOpacity[y]!;
        const mistWeight = mb + mt + ml + mr;
        const mistReach =
          mistWeight > 0
            ? (mb * bottom.mistReach[x]! +
                mt * top.mistReach[x]! +
                ml * left.mistReach[y]! +
                mr * right.mistReach[y]!) /
              mistWeight
            : 0;
        const coreAlpha =
          coreWeight > 0 && glowReach > 0 && sides > 0.0001
            ? (glow.edgeOpacity *
                Math.exp(-depth / sides / glowReach) *
                Math.min(1, coreWeight / weight) *
                (cb * bottom.opacity[x]! + ct * top.opacity[x]! + cl * left.opacity[y]! + cr * right.opacity[y]!)) /
              coreWeight
            : 0;
        const mistAlpha =
          mistWeight > 0 && mistReach > 0 && sides > 0.0001
            ? (glow.haloOpacity *
                Math.exp(-depth / sides / mistReach) *
                Math.min(1, mistWeight / weight) *
                (mb * bottom.opacity[x]! + mt * top.opacity[x]! + ml * left.opacity[y]! + mr * right.opacity[y]!)) /
              mistWeight
            : 0;
        const glowAlpha = 1 - (1 - coreAlpha) * (1 - mistAlpha);
        const outputAlpha = glowAlpha;
        const blend = glowWeight > 0 && glowAlpha > 0 ? glowAlpha / Math.max(0.0001, outputAlpha) : 0;
        if (blend < 1) {
          // Unwrap opposite the arc midpoint. Partial arcs have no colour seam
          // at an endpoint; a full circle wraps the closed palette continuously.
          // The visible glow replaces this palette completely. Only its faint
          // tail needs the underlying colour, including during transitions.
          colour(colorPositions[index / 4]! - colorPhase, index);
        }
        if (blend > 0) {
          image.data[index] =
            image.data[index]! * (1 - blend) +
            (blend * (gb * bottom.red[x]! + gt * top.red[x]! + gl * left.red[y]! + gr * right.red[y]!)) / glowWeight;
          image.data[index + 1] =
            image.data[index + 1]! * (1 - blend) +
            (blend * (gb * bottom.green[x]! + gt * top.green[x]! + gl * left.green[y]! + gr * right.green[y]!)) /
              glowWeight;
          image.data[index + 2] =
            image.data[index + 2]! * (1 - blend) +
            (blend * (gb * bottom.blue[x]! + gt * top.blue[x]! + gl * left.blue[y]! + gr * right.blue[y]!)) /
              glowWeight;
        }
        image.data[index + 3] = 255;
        // Reveal from the physical edge by expanding inward. The
        // edge and halo opacity controls stay direct; the outgoing bottom field yields
        // without adding a second layer of opacity at shared pixels.
        const visibleInput = inputAlpha * (1 - sides);
        if (layeredInput && visibleInput > 0) {
          const amount = visibleInput / Math.max(0.0001, visibleInput + outputAlpha);
          for (let channel = 0; channel < 3; channel++)
            image.data[index + channel] =
              image.data[index + channel]! * (1 - amount) + layeredInput.data[referenceIndex + channel]! * amount;
        }
        alpha.data[index + 3] = Math.max(visibleInput, outputAlpha) * 255;
      }
    }
    fieldContext.putImageData(image, 0, 0);
    maskContext.putImageData(alpha, 0, 0);
    context.clearRect(0, 0, width, height);
    const pattern = dark ? darkTexture : texture;
    if (dark) context.drawImage(field, 0, 0, width, height);
    if (textureSettings.enabled && textureSettings.opacity > 0 && pattern) {
      context.globalCompositeOperation = 'source-over';
      // The dark SVG owns the Figma triangle mask; its group opacity is applied here.
      // Overlay acts on the texture above the colour field, before applying
      // the sound envelope once. The light design keeps its original order.
      context.globalAlpha = dark
        ? textureSettings.opacity <= defaultAudioRippleAppearance.texture.opacity
          ? (textureSettings.opacity / defaultAudioRippleAppearance.texture.opacity) * 0.3
          : 0.3 +
            ((textureSettings.opacity - defaultAudioRippleAppearance.texture.opacity) /
              (1 - defaultAudioRippleAppearance.texture.opacity)) *
              0.7
        : textureSettings.opacity;
      if (dark) context.globalCompositeOperation = 'overlay';
      const textureHeight = (905.257 / 1080) * height;
      const textureY = (175 / 1080) * height;
      // Preserve the design's lower placement and extend the same texture
      // above it so arcs reaching the top share the textured colour field.
      for (const y of [textureY - textureHeight, textureY])
        context.drawImage(pattern, (-37 / 1920) * width, y, (1994 / 1920) * width, textureHeight);
      context.globalAlpha = 1;
      // Canvas equivalent of mix-blend-mode: soft-light on the colour layer.
      if (!dark) context.globalCompositeOperation = 'soft-light';
    }
    if (!dark) context.drawImage(field, 0, 0, width, height);
    // Mask the composed colour and texture together, including the release tail.
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(mask, 0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
    return true;
  };
  return {
    draw,
    resize,
    update(value: RippleSettings) {
      currentSettings = value;
    },
    setPalette(value: RipplePalette) {
      palettes = value;
      dark = value.dark;
    },
    setSignal(value: RippleSignal | null) {
      signal = value;
    },
    setMotion(value: boolean) {
      reducedMotion = value;
    },
    resume() {
      previous = 0;
    },
  };
}
