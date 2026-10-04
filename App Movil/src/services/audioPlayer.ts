import { Linking } from 'react-native';

/**
 * Reproductor simple de grabaciones (.wav) del servidor.
 * En la app web (servida desde la Mac) usa el reproductor del navegador; en la app nativa abre
 * el audio en el navegador del teléfono.
 */
let current: any = null;
let currentUrl: string | null = null;
const listeners = new Set<(url: string | null) => void>();

const notify = () => listeners.forEach((l) => l(currentUrl));

export const audioPlayer = {
  isWeb(): boolean {
    return typeof window !== 'undefined' && !!(window as any).Audio;
  },

  playing(): string | null {
    return currentUrl;
  },

  onChange(listener: (url: string | null) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  stop() {
    if (current) {
      current.pause();
      current.currentTime = 0;
    }
    current = null;
    currentUrl = null;
    notify();
  },

  async toggle(url: string) {
    if (currentUrl === url) {
      this.stop();
      return;
    }
    this.stop();
    if (!this.isWeb()) {
      await Linking.openURL(url);
      return;
    }
    const audio = new (window as any).Audio(url);
    audio.onended = () => this.stop();
    current = audio;
    currentUrl = url;
    notify();
    try {
      await audio.play();
    } catch {
      this.stop();
    }
  },
};
