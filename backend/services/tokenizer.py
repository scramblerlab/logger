import fugashi
import unidic_lite

_tagger = fugashi.Tagger(f'-d {unidic_lite.DICDIR}')  # dictionary loaded once at import


def tokenize_ja(text: str) -> str:
    """Tokenize Japanese (and mixed) text into space-separated surface forms for FTS5."""
    return ' '.join(word.surface for word in _tagger(text))
