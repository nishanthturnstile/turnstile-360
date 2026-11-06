"""Security regressions over the actual Linux namespace parser."""

import tempfile

import pytest

from turnstile_processing.assessment import isolated_text


@pytest.mark.parametrize(
    "data,expected",
    [
        (b"Safe text\n", "OK"),
        (b"%PDF-1.7 fake text", "INVALID_TEXT"),
        (b"PK\x03\x04zip", "INVALID_TEXT"),
        (b"\xff", "INVALID_TEXT"),
        (b"hello\0bad", "INVALID_TEXT"),
        (b"", "INVALID_TEXT"),
        (b"\xf0\x9f", "INVALID_TEXT"),
    ],
)
def test_isolated_text(data: bytes, expected: str) -> None:
    with tempfile.TemporaryFile() as source:
        source.write(data)
        assert isolated_text(source) == expected
