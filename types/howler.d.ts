declare module "howler" {
  export interface HowlOptions {
    src: string | string[];
    html5?: boolean;
    autoplay?: boolean;
    rate?: number;
    format?: string | string[];
    onend?: (soundId: number) => void;
    onloaderror?: (soundId: number, error: unknown) => void;
    onplayerror?: (soundId: number, error: unknown) => void;
  }

  export class Howl {
    constructor(options: HowlOptions);
    play(spriteOrId?: string | number): number;
    pause(id?: number): this;
    stop(id?: number): this;
    unload(): this;
  }
}
