"""Cross-language fixtures for generated consumer JSON Schema; no remote resolution."""

import json
from pathlib import Path
from typing import Any

import regex  # type: ignore[import-untyped]
from jsonschema import (  # type: ignore[import-untyped]
    Draft202012Validator,
    FormatChecker,
    ValidationError,
    validators,
)

ROOT = Path(__file__).resolve().parents[1]


def unicode_pattern(validator: Any, pattern: str, instance: Any, schema: Any) -> Any:
    # Zod exports ECMAScript Unicode properties (\p{L}/\p{N}); Python re lacks them.
    if isinstance(instance, str) and regex.search(pattern, instance) is None:
        yield ValidationError("String does not match the contract pattern")


def main() -> None:
    spec = json.loads((ROOT / "docs/api/dms.openapi.json").read_text())
    assert spec["openapi"] == "3.1.0"
    validator_class = validators.extend(Draft202012Validator, {"pattern": unicode_pattern})
    fixtures = json.loads((ROOT / "scripts/fixtures/dms-contracts.json").read_text())
    for schema in spec["components"]["schemas"].values():
        # The Unicode pattern validator uses the same JSON Schema dialect; custom
        # regex checking happens on fixtures rather than Python re meta-validation.
        validator_class(schema, format_checker=FormatChecker())
    for case in fixtures:
        schema = spec["components"]["schemas"][case["schema"]]
        validator = validator_class(schema, format_checker=FormatChecker())
        assert validator.is_valid(case["value"]) is case["valid"], case["schema"]
    for operation_map in spec["paths"].values():
        for operation in operation_map.values():
            for response in operation["responses"].values():
                media = response["content"]["application/json"]
                name = media["schema"]["$ref"].rsplit("/", 1)[1]
                validator_class(
                    spec["components"]["schemas"][name], format_checker=FormatChecker()
                ).validate(media["example"])
    print("Python draft-2020-12 consumer examples and positive/negative fixtures pass")


if __name__ == "__main__":
    main()
