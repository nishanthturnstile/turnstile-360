"""Explicit private RabbitMQ definitions; no default/shared broker principal."""

import base64
import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from .contracts import ROLES, TASKS


def definitions(environment: dict[str, str]) -> dict[str, Any]:
    users, permissions, topics = [], [], []
    names, passwords = set(), set()
    for role in ROLES:
        prefix = f"DMS_BROKER_{role.upper()}"
        name, password = environment[f"{prefix}_USER"], environment[f"{prefix}_PASSWORD"]
        if (
            not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{2,63}", name)
            or len(password) < 32
            or len(set(password)) < 16
            or name in names
            or password in passwords
        ):
            raise ValueError("Distinct private broker credentials required")
        names.add(name)
        passwords.add(password)
        salt = os.urandom(4)
        users.append(
            {
                "name": name,
                "password_hash": base64.b64encode(
                    salt + hashlib.sha256(salt + password.encode()).digest()
                ).decode(),
                "hashing_algorithm": "rabbit_password_hashing_sha256",
                "tags": [],
            }
        )
        task = next((task for task, owner in TASKS.items() if owner == role), None)
        if role == "publisher":
            configure, write, read = "^$", r"^dms\.work$", "^$"
            routing = r"^document\.(scan|extract|heavy)$"
        else:
            if task is None:
                raise ValueError("Fixed task role required")
            escaped = re.escape(task)
            configure = rf"^(dms\.work|{escaped})$"
            write = rf"^(dms\.work|dms\.dead|{escaped})$"
            read = rf"^(dms\.work|{escaped})$"
            routing = rf"^{escaped}$"
        permissions.append(
            {"user": name, "vhost": "dms", "configure": configure, "write": write, "read": read}
        )
        topics.append(
            {
                "user": name,
                "vhost": "dms",
                "exchange": "dms.work",
                "write": routing,
                "read": routing if task else "^$",
            }
        )
    exchanges: list[dict[str, Any]] = [
        {
            "name": name,
            "vhost": "dms",
            "type": "topic",
            "durable": True,
            "auto_delete": False,
            "internal": False,
            "arguments": {},
        }
        for name in ("dms.work", "dms.dead")
    ]
    queues: list[dict[str, Any]] = []
    bindings: list[dict[str, Any]] = []
    for task in TASKS:
        for dead in (False, True):
            name = f"{task}.dead" if dead else task
            queues.append(
                {
                    "name": name,
                    "vhost": "dms",
                    "durable": True,
                    "auto_delete": False,
                    "arguments": {}
                    if dead
                    else {
                        "x-dead-letter-exchange": "dms.dead",
                        "x-dead-letter-routing-key": f"{task}.dead",
                    },
                }
            )
            bindings.append(
                {
                    "source": "dms.dead" if dead else "dms.work",
                    "vhost": "dms",
                    "destination": name,
                    "destination_type": "queue",
                    "routing_key": name,
                    "arguments": {},
                }
            )
    return {
        "vhosts": [{"name": "dms"}],
        "users": users,
        "permissions": permissions,
        "topic_permissions": topics,
        "exchanges": exchanges,
        "queues": queues,
        "bindings": bindings,
    }


def write_definitions(path: Path) -> None:
    data = definitions(dict(os.environ))
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as target:
        json.dump(data, target)
        target.flush()
        os.fsync(target.fileno())
