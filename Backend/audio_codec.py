"""
Compresión SIN PÉRDIDA del audio del ESP32 (formato "rice1"; codificador en Esp32/rice_codec.h).

El ESP32 envía el audio comprimido (~40 % menos datos) y el SHA-256 del PCM original.
Aquí se reconstruye el PCM exacto; audio_service compara luego la longitud y el SHA-256,
así que un error de compresión o de transmisión nunca llega al análisis.
Formato: ver el comentario de Esp32/rice_codec.h.
"""
import numpy as np

BLOCK = 1024
RAW_BLOCK = 0xFF


def _zigzag(r: np.ndarray) -> np.ndarray:
    return np.where(r >= 0, r << 1, ((-r) << 1) - 1)


def encode(pcm: np.ndarray) -> bytes:
    """Referencia en Python del codificador del ESP32 (mismas decisiones por bloque); se usa en las pruebas."""
    x = np.asarray(pcm, dtype=np.int16)
    out = bytearray()
    for start in range(0, len(x), BLOCK):
        blk = x[start:start + BLOCK].astype(np.int64)
        n = len(blk)
        best = None   # (bits, orden, k)
        for order in (1, 2):
            if n <= order:
                continue
            pred = blk[order - 1:-1] if order == 1 else 2 * blk[1:-1] - blk[:-2]
            u = _zigzag(blk[order:] - pred)
            mean = int(u.sum()) // (n - order)
            k0 = 0
            while k0 < 15 and (1 << (k0 + 1)) <= mean:
                k0 += 1
            for k in range(max(0, k0 - 1), min(15, k0 + 1) + 1):
                bits = int(((u >> k) + 1 + k).sum())
                if best is None or bits < best[0]:
                    best = (bits, order, k)
        raw_size = 1 + 2 * n
        if best is None or 1 + 2 * best[1] + (best[0] + 7) // 8 >= raw_size:
            out.append(RAW_BLOCK)
            out += blk.astype('<i2').tobytes()
            continue
        _, order, k = best
        out.append(order << 4 | k)
        out += blk[:order].astype('<i2').tobytes()
        pred = blk[order - 1:-1] if order == 1 else 2 * blk[1:-1] - blk[:-2]
        bits = []
        for u in _zigzag(blk[order:] - pred).tolist():
            bits += [1] * (u >> k) + [0] + [(u >> b) & 1 for b in range(k - 1, -1, -1)]
        out += np.packbits(np.array(bits, dtype=np.uint8)).tobytes()
    return bytes(out)


def decode(data: bytes, n_samples: int) -> np.ndarray:
    """Reconstruye n_samples muestras int16. ValueError si los datos no son un flujo rice1 válido."""
    out = np.empty(n_samples, dtype=np.int16)
    pos = done = 0
    while done < n_samples:
        n = min(BLOCK, n_samples - done)
        if pos >= len(data):
            raise ValueError("Audio comprimido incompleto")
        header = data[pos]
        pos += 1
        if header == RAW_BLOCK:
            if pos + 2 * n > len(data):
                raise ValueError("Bloque sin comprimir incompleto")
            out[done:done + n] = np.frombuffer(data, dtype='<i2', count=n, offset=pos)
            pos += 2 * n
            done += n
            continue
        order, k = header >> 4, header & 0x0F
        if order not in (1, 2) or n <= order or pos + 2 * order > len(data):
            raise ValueError("Cabecera de bloque inválida")
        x = np.frombuffer(data, dtype='<i2', count=order, offset=pos).astype(np.int64).tolist()
        pos += 2 * order
        # Un bloque comprimido nunca ocupa más que sin comprimir (2 bytes por muestra): basta leer eso.
        bits = np.unpackbits(np.frombuffer(data[pos:pos + 2 * n], dtype=np.uint8))
        # Siguiente cero desde cada posición (fin del código unario) y valor de los k bits que empiezan ahí.
        nbits = len(bits)
        zero_at = np.where(bits == 0, np.arange(nbits), nbits)
        next_zero = np.minimum.accumulate(zero_at[::-1])[::-1].tolist() + [nbits]
        low = np.zeros(nbits + 1, dtype=np.int64)
        for b in range(k):
            shifted = np.zeros(nbits + 1, dtype=np.int64)
            shifted[:nbits - b] = bits[b:]
            low = (low << 1) | shifted
        low = low.tolist()
        s = 0
        for _ in range(n - order):
            z = next_zero[s]
            if z + 1 + k > nbits:
                raise ValueError("Bloque comprimido incompleto")
            u = ((z - s) << k) | low[z + 1]
            r = (u >> 1) if not u & 1 else -((u + 1) >> 1)
            pred = x[-1] if order == 1 else 2 * x[-1] - x[-2]
            v = pred + r
            if not -32768 <= v <= 32767:
                raise ValueError("Muestra fuera de rango al descomprimir")
            x.append(v)
            s = z + 1 + k
        out[done:done + n] = x
        pos += (s + 7) // 8
        done += n
    if pos != len(data):
        raise ValueError("Sobran datos después del audio comprimido")
    return out
