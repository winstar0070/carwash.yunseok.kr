import struct
import zlib
from pathlib import Path


def curve(start: tuple[float, float], first: tuple[float, float], second: tuple[float, float], end: tuple[float, float]) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for step in range(81):
        t = step / 80
        coordinates = [(1 - t) ** 3 * start[i] + 3 * (1 - t) ** 2 * t * first[i] + 3 * (1 - t) * t ** 2 * second[i] + t ** 3 * end[i] for i in (0, 1)]
        points.append((coordinates[0], coordinates[1]))
    return points


outline = curve((0.5, 0.2), (0.46, 0.28), (0.29, 0.45), (0.29, 0.57))
outline += curve((0.29, 0.57), (0.29, 0.86), (0.71, 0.86), (0.71, 0.57))
outline += curve((0.71, 0.57), (0.71, 0.45), (0.54, 0.28), (0.5, 0.2))


def inside(x: float, y: float) -> bool:
    crossings = 0
    for (ax, ay), (bx, by) in zip(outline, outline[1:] + outline[:1]):
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            crossings += 1
    return crossings % 2 == 1


def chunk(name: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data))


directory = Path(__file__).resolve().parent.parent / "icons"
directory.mkdir(exist_ok=True)
for size, filename in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            dark = inside((x + 0.5) / size, (y + 0.5) / size)
            shade = 23 if dark else 255
            rows.extend((shade, shade, shade))
    data = b"\x89PNG\r\n\x1a\n"
    data += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(bytes(rows), 9))
    data += chunk(b"IEND", b"")
    (directory / filename).write_bytes(data)
