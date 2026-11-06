"""Fixed Celery protocol with mandatory, confirmed initial and retry publication."""

import os
import urllib.parse
from typing import Any

from celery import Celery, Task  # type: ignore[import-untyped]
from kombu.entity import Exchange as _Exchange
from kombu.entity import Queue as _Queue
from kombu.messaging import Producer as _Producer

Exchange: Any = _Exchange
Queue: Any = _Queue
Producer: Any = _Producer

from .contracts import TASKS, validate


class Unroutable(Exception):
    pass


def returned(*args: Any, **kwargs: Any) -> None:
    raise Unroutable("Required work binding is unavailable")


def queues() -> tuple[Any, ...]:
    exchange = Exchange("dms.work", type="topic", durable=True, delivery_mode=2)
    return tuple(
        Queue(
            task,
            exchange=exchange,
            routing_key=task,
            durable=True,
            queue_arguments={
                "x-dead-letter-exchange": "dms.dead",
                "x-dead-letter-routing-key": f"{task}.dead",
            },
        )
        for task in TASKS
    )


def make_app(broker_url: str | None = None) -> Any:
    broker = broker_url or os.environ["DMS_BROKER_URL"]
    parsed = urllib.parse.urlsplit(broker)
    if (
        parsed.scheme not in ("amqp", "amqps")
        or not parsed.hostname
        or not parsed.username
        or not parsed.password
        or parsed.path != "/dms"
    ):
        raise ValueError("Explicit scoped AMQP connection required")
    if parsed.scheme == "amqp" and os.environ.get("DMS_WORK_ALLOW_HTTP") != "true":
        raise ValueError("Explicit private plaintext transport opt-in required")
    app = Celery("thaarei-work", broker=broker, backend=None)
    app.conf.update(
        accept_content=["json"],
        task_serializer="json",
        result_serializer="json",
        task_protocol=2,
        task_ignore_result=True,
        task_store_errors_even_if_ignored=False,
        task_acks_late=True,
        task_acks_on_failure_or_timeout=True,
        task_reject_on_worker_lost=False,
        worker_prefetch_multiplier=1,
        worker_enable_remote_control=False,
        worker_cancel_long_running_tasks_on_connection_loss=True,
        worker_send_task_events=False,
        task_send_sent_event=False,
        task_publish_retry=False,
        task_create_missing_queues=False,
        broker_connection_max_retries=3,
        broker_connection_timeout=5,
        broker_heartbeat=20,
        broker_transport_options={"confirm_publish": True},
        task_soft_time_limit=580,
        task_time_limit=600,
        task_queues=queues(),
        task_default_queue="document.scan",
        task_default_exchange="dms.work",
        task_default_exchange_type="topic",
        task_routes={
            task: {"queue": task, "exchange": "dms.work", "routing_key": task} for task in TASKS
        },
    )
    return app


class ConfirmedTask(Task):  # type: ignore[misc]
    abstract = True
    max_retries = 2

    def apply_async(
        self,
        args: Any = None,
        kwargs: Any = None,
        task_id: Any = None,
        producer: Any = None,
        **options: Any,
    ) -> Any:
        if self.name not in TASKS:
            raise ValueError("Fixed task required")
        if not isinstance(args, (list, tuple)) or len(args) != 1 or kwargs:
            raise ValueError("One reference-only envelope required")
        envelope = validate("Envelope", args[0])
        if envelope["task"] != self.name:
            raise ValueError("Task/envelope mismatch")
        # Do not silently redeclare a missing binding while publishing. The explicit
        # topology command owns installation; both first send and Task.retry use here.
        options.update(
            queue=self.name,
            exchange="dms.work",
            routing_key=self.name,
            mandatory=True,
            delivery_mode=2,
            retry=False,
            declare=[],
            confirm_timeout=5,
        )
        with (
            self.app.connection_for_write() as connection,
            Producer(connection, auto_declare=False, on_return=returned) as confirmed,
        ):
            return super().apply_async(
                args=args, kwargs={}, task_id=task_id, producer=confirmed, **options
            )


def topology(app: Any) -> None:
    with app.connection_for_write() as connection:
        channel = connection.channel()
        dead = Exchange("dms.dead", type="topic", durable=True)
        dead(channel).declare()
        for queue in queues():
            Queue(
                f"{queue.name}.dead", exchange=dead, routing_key=f"{queue.name}.dead", durable=True
            )(channel).declare()
            queue(channel).declare()
