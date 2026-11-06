"""Private processing process entrypoints; no implicit broker/client configuration."""


def main() -> None:
    import argparse
    import os

    from .broker import make_app, topology
    from .client import Client
    from .contracts import TASKS
    from .publisher import publish_once
    from .tasks import register_tasks

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "mode",
        choices=(
            "topology",
            "publisher",
            "publisher-once",
            "worker",
            "check",
            "broker-config",
            "service-check",
            "extract-local",
        ),
    )
    parser.add_argument("--output")
    parser.add_argument("--source")
    parser.add_argument("--request")
    args = parser.parse_args()
    if args.mode == "service-check":
        from .service_health import check

        raise SystemExit(0 if check() else 1)
    if args.mode == "extract-local":
        import json
        from pathlib import Path

        from .contracts import validate
        from .extraction_supervisor import isolated_extract

        if not args.output or not args.source or not args.request:
            raise ValueError("Explicit source, bounded request and exclusive output paths required")
        with Path(args.request).open("rb") as request_stream:
            request = validate("ExtractionRequest", json.loads(request_stream.read(8193)))
        artifact = isolated_extract(Path(args.source), request)
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output_stream:
            json.dump(artifact, output_stream, ensure_ascii=False)
        print("Local parser qualification completed; no security approval or publication performed")
        return
    if args.mode == "broker-config":
        from pathlib import Path

        from .broker_setup import write_definitions

        if not args.output:
            raise ValueError("Exclusive protected output path required")
        write_definitions(Path(args.output))
        return
    if args.mode == "check":
        print("Private fixed-task runtime and versioned contracts loaded")
        return
    app = make_app()
    register_tasks(app)
    if args.mode == "topology":
        topology(app)
        return
    presence = None
    if os.environ.get("DMS_OPERATIONS_ENABLED") == "true":
        from .service_health import Presence

        presence = Presence(os.environ["DMS_WORK_ROLE"], app)
    if args.mode in ("publisher", "publisher-once"):
        client = Client("publisher")
        import signal
        import threading

        stop = threading.Event()
        if args.mode == "publisher":

            def stopping(signum: int, frame: object) -> None:
                stop.set()
                if presence:
                    presence.close()

            for name in (signal.SIGTERM, signal.SIGINT):
                signal.signal(name, stopping)
            if presence:
                presence.start()
        while not stop.is_set():
            try:
                publish_once(app, client, stop)
            except Exception:  # noqa: BLE001 -- Process boundary never logs credential-bearing transport exceptions.
                print("Private publication unavailable; retained delivery will be retried")
                if args.mode == "publisher-once":
                    raise SystemExit(1) from None
            if args.mode == "publisher-once":
                return
            stop.wait(1)
        if presence:
            presence.close()
            presence.thread.join(timeout=5)
        return
    role = os.environ["DMS_WORK_ROLE"]
    names = [task for task, owner in TASKS.items() if owner == role]
    if len(names) != 1:
        raise ValueError("Explicit scanner/extractor/heavy worker role required")
    if presence:
        from celery import signals  # type: ignore[import-untyped]

        signals.worker_ready.connect(lambda **kwargs: presence.start(), weak=False)
        signals.worker_shutting_down.connect(presence.close, weak=False)
        signals.worker_shutdown.connect(presence.close, weak=False)
    app.worker_main(
        [
            "worker",
            "--queues",
            names[0],
            "--concurrency",
            "2" if role == "scanner" else "1",
            "--pool",
            "prefork",
            "--loglevel",
            "ERROR",
            "--without-gossip",
            "--without-mingle",
            "--without-heartbeat",
        ]
    )
    if presence:
        presence.close()
        presence.thread.join(timeout=5)
