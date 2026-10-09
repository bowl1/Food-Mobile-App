"""Short-lived, size-bounded recovery files; never a replacement for cloud Storage."""
from pathlib import Path
from threading import RLock
import time
from .config import settings

spool_lock = RLock()


def trim_spool(protect: Path | None = None, incoming=0):
    with spool_lock:
        root = Path(settings().image_spool_dir)
        if not root.exists():
            return
        files = []
        for file in root.iterdir():
            if file.suffix not in ('.jpg','.tmp'):
                continue
            try:
                if file.is_file():
                    files.append((file,file.stat()))
            except FileNotFoundError:
                continue  # Another completed job already removed its recovery file.
        cutoff = time.time() - 86400
        kept = []
        for file, stat in files:
            if file != protect and stat.st_mtime < cutoff:
                file.unlink(missing_ok=True)
            else:
                kept.append((file,stat))
        total = sum(stat.st_size for _,stat in kept) + incoming
        if incoming:
            total -= sum(stat.st_size for file,stat in kept if file == protect)
        for file,stat in sorted(kept,key=lambda item:item[1].st_mtime):
            if total <= settings().image_spool_max_bytes:
                break
            if file != protect:
                total -= stat.st_size
                file.unlink(missing_ok=True)
