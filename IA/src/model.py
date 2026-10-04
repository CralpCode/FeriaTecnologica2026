"""CNNs livianas sobre espectrogramas log-mel (corazón y pulmón)."""
import torch
from torch import nn


def _block(c_in: int, c_out: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(c_in, c_out, kernel_size=3, padding=1, bias=False),
        nn.BatchNorm2d(c_out),
        nn.ReLU(inplace=True),
        nn.Conv2d(c_out, c_out, kernel_size=3, padding=1, bias=False),
        nn.BatchNorm2d(c_out),
        nn.ReLU(inplace=True),
        nn.MaxPool2d(2),
    )


class HeartCNN(nn.Module):
    """
    4 bloques convolucionales + pooling global. ~0.4 M parámetros.
    n_outputs=1 -> logit binario (normal/anormal); n_outputs>1 -> logits de varias clases.
    """

    def __init__(self, dropout: float = 0.3, n_outputs: int = 1):
        super().__init__()
        self.n_outputs = n_outputs
        self.features = nn.Sequential(
            _block(1, 16), _block(16, 32), _block(32, 64), _block(64, 128),
        )
        self.head = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Dropout(dropout),
            nn.Linear(128, n_outputs),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (batch, 1, n_mels, frames) -> logits (batch,) o (batch, n_outputs)"""
        out = self.head(self.features(x))
        return out.squeeze(1) if self.n_outputs == 1 else out


class MultiHeadCNN(nn.Module):
    """
    Mismo extractor convolucional con una cabeza de clasificación por característica.
    Devuelve todos los logits concatenados (batch, suma de clases); el .json del modelo
    indica qué columnas pertenecen a cada característica.
    """

    def __init__(self, head_sizes: list[int], dropout: float = 0.3):
        super().__init__()
        self.features = nn.Sequential(
            _block(1, 16), _block(16, 32), _block(32, 64), _block(64, 128),
        )
        self.pool = nn.Sequential(nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Dropout(dropout))
        self.heads = nn.ModuleList([nn.Linear(128, k) for k in head_sizes])

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        z = self.pool(self.features(x))
        return torch.cat([h(z) for h in self.heads], dim=1)
