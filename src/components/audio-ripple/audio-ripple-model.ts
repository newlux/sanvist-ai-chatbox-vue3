export interface AudioRippleInputAppearance {
  /** Inward distance in CSS pixels at silence. */
  baseWidth: number;
  /** Inward distance in CSS pixels at peak loudness, including the base. */
  maxWidth: number;
  /** Multiplier for audio response. */
  speed: number;
  /** Visible frequency bounds in Hz; the display uses auditory bands within this range. */
  minFrequency: number;
  maxFrequency: number;
  /** Maximum quiet display loudness, from 0 to 1; does not alter measured audio. */
  idleAmplitude: number;
}

export interface AudioRippleOutputAppearance {
  /** Thin colour edge opacity and inward diffusion length in CSS pixels. */
  edgeOpacity: number;
  edgeWidth: number;
  /** Soft outer glow opacity and inward diffusion length in CSS pixels. */
  haloOpacity: number;
  haloWidth: number;
  /** Along-edge travel relative to one colour region, from 0 to 1. */
  travel: number;
  /** Local width and depth deformation, from 0 to 1. */
  deformation: number;
  /** Multiplier for glow motion and audio response. */
  speed: number;
  /** Colour revolutions per minute; zero pauses colour rotation. */
  colorSpeed: number;
  /** Independent left endpoint: top 90, left 180, bottom 270. */
  startAngle: number;
  /** Independent right endpoint: bottom -90, right 0, top 90. Connect via the bottom. */
  endAngle: number;
}

export interface AudioRippleTextureAppearance {
  /** Shared triangle texture for input and output. */
  enabled: boolean;
  /** Texture strength, from 0 to 1; the default uses each theme's design opacity. */
  opacity: number;
}

export const defaultAudioRippleAppearance: {
  readonly input: Readonly<AudioRippleInputAppearance>;
  readonly output: Readonly<AudioRippleOutputAppearance>;
  readonly texture: Readonly<AudioRippleTextureAppearance>;
} = {
  input: {
    baseWidth: 108,
    maxWidth: 240,
    speed: 1.6,
    minFrequency: 50,
    maxFrequency: 8000,
    idleAmplitude: 0.12,
  },
  output: {
    edgeOpacity: 0.98,
    edgeWidth: 28,
    haloOpacity: 0.34,
    haloWidth: 86,
    travel: 0.49,
    deformation: 0.53,
    speed: 1.55,
    colorSpeed: 3,
    startAngle: 151,
    endAngle: 30,
  },
  texture: { enabled: true, opacity: 0.13 },
};
export const defaultAudioRippleIdleSpeed = 0.35;

/** Component-owned presentation data; never an audio device or business state. */
export interface RippleSettings {
  variant: 'input' | 'error' | 'output';
  inputAppearance?: Partial<AudioRippleInputAppearance>;
  outputAppearance?: Partial<AudioRippleOutputAppearance>;
  textureAppearance?: Partial<AudioRippleTextureAppearance>;
  idleSpeed: number;
  preview?: 'silence' | 'speech' | 'static';
}
export interface RipplePalette {
  dark: boolean;
  input: Float32Array;
  error: Float32Array;
  output: Float32Array;
}
export interface RippleSignal {
  id: number;
  sampleRate: number;
  fftSize: number;
  running: boolean;
  spectrum: Float32Array<ArrayBuffer>;
  samples: Float32Array<ArrayBuffer>;
}
export interface RippleSize {
  width: number;
  height: number;
  ratio: number;
}
export interface RippleImages<T = CanvasImageSource> {
  texture: T | null;
  darkTexture: T | null;
  darkInput: T | null;
}
export type RippleWorkerMessage =
  | {
      type: 'init';
      canvas: OffscreenCanvas;
      settings: RippleSettings;
      palette: RipplePalette;
      size: RippleSize;
      images: RippleImages<ImageBitmap>;
      reducedMotion: boolean;
      visible: boolean;
    }
  | { type: 'settings'; settings: RippleSettings }
  | { type: 'palette'; palette: RipplePalette }
  | { type: 'size'; size: RippleSize }
  | { type: 'motion'; reducedMotion: boolean }
  | { type: 'visible'; visible: boolean }
  | { type: 'signal'; signal: RippleSignal | null; requested?: true };
export type RippleWorkerReply = { type: 'sample' } | { type: 'ready' };
