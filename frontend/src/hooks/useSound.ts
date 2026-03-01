const audioCache = new Map<string, HTMLAudioElement>();
const DEFAULT_SOUND: SoundEffect = 'notification';
const DEFAULT_VOLUME = 0.35;

export type SoundEffect =
  | 'violation-alert'
  | 'watchlist-alert'
  | 'crowd-alert'
  | 'device-offline'
  | 'device-online'
  | 'success'
  | 'error'
  | 'notification'
  | 'expand'
  | 'collapse';

function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem('iris_sound_alerts') !== 'false';
  } catch {
    return true;
  }
}

function getAudio(name: string): HTMLAudioElement {
  let audio = audioCache.get(name);
  if (!audio) {
    audio = new Audio(`/sounds/${name}.mp3`);
    audio.preload = 'auto';
    audioCache.set(name, audio);
  }
  return audio;
}

export function playSound(name: SoundEffect): void {
  void name;
  if (!isSoundEnabled()) return;
  try {
    const audio = getAudio(DEFAULT_SOUND);
    audio.volume = DEFAULT_VOLUME;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {
    // ignore – user hasn't interacted yet or browser blocked
  }
}

// Play any sound file under /public/sounds (without needing to extend the SoundEffect union).
// Example: playSoundName("expand-itms")
export function playSoundName(name: string, volume?: number): void {
  void name;
  void volume;
  if (!isSoundEnabled()) return;
  try {
    const audio = getAudio(DEFAULT_SOUND);
    audio.volume = DEFAULT_VOLUME;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {
    // ignore
  }
}
