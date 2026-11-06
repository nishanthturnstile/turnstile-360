"""Generated, closed private schemas; task envelopes contain references only."""

import json
from importlib.resources import files
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker  # type: ignore[import-untyped]

CONTRACT = json.loads(files("turnstile_processing").joinpath("work-contract.json").read_text())
TASKS: dict[str, str] = CONTRACT["tasks"]
ROLES: dict[str, str] = CONTRACT["roles"]


def validate(name: str, value: Any) -> dict[str, Any]:
    Draft202012Validator(CONTRACT["schemas"][name], format_checker=FormatChecker()).validate(value)
    if not isinstance(value, dict):
        raise TypeError("Expected a bounded work object")
    return value
