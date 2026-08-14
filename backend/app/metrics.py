from prometheus_client import Counter

PUBLISH_OPERATIONS = Counter(
    "page_builder_publish_operations_total",
    "Publish, schedule, rollback, and batch item outcomes",
    ("operation", "result"),
)
UPLOAD_OPERATIONS = Counter(
    "page_builder_upload_operations_total",
    "Asset upload and replacement outcomes",
    ("operation", "result"),
)
SCHEDULER_OPERATIONS = Counter(
    "page_builder_scheduler_operations_total",
    "Scheduled publishing outcomes",
    ("result",),
)
WORKER_OPERATIONS = Counter(
    "page_builder_worker_operations_total",
    "Background worker outcomes",
    ("kind", "result"),
)
