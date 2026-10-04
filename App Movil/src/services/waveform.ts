/**
 * Onda de una grabación real: se descarga el WAV del servidor, se decodifica con Web Audio y se resume en picos.
 * Solo en web (en Android no hay decodificador); si algo falla, no se dibuja nada (nunca se inventa una onda).
 */
const cache = new Map<string, Promise<number[] | null>>();

export function waveformSupported(): boolean {
  return typeof window !== 'undefined' && !!((window as any).AudioContext || (window as any).webkitAudioContext)
    && typeof fetch === 'function';
}

async function compute(url: string, bars: number): Promise<number[] | null> {
  const Ctx = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const Live = (window as any).AudioContext || (window as any).webkitAudioContext;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.arrayBuffer();
  // Un contexto fuera de línea evita pedir permiso de audio al navegador solo para decodificar
  const ctx = Ctx ? new Ctx(1, 2, 44100) : new Live();
  const buffer: AudioBuffer = await new Promise((ok, fail) => {
    const p = ctx.decodeAudioData(data, ok, fail);
    if (p && typeof p.then === 'function') p.then(ok, fail);
  });
  if (!Ctx && typeof ctx.close === 'function') ctx.close();
  const ch = buffer.getChannelData(0);
  if (!ch.length) return null;
  const step = Math.max(1, Math.floor(ch.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    let max = 0;
    const end = Math.min(ch.length, (i + 1) * step);
    for (let j = i * step; j < end; j++) {
      const v = Math.abs(ch[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  // Se normaliza para que se vea la forma; la altura no es el volumen real
  const top = Math.max(...peaks);
  return top > 0 ? peaks.map((p) => p / top) : peaks;
}

export function loadWaveform(url: string, bars = 120): Promise<number[] | null> {
  if (!waveformSupported()) return Promise.resolve(null);
  const key = `${url}|${bars}`;
  if (!cache.has(key)) cache.set(key, compute(url, bars).catch(() => null));
  return cache.get(key)!;
}
