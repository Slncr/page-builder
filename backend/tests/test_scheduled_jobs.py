from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
from fastapi import FastAPI

from app.models import JobStatus, PublishJob
from tests.conftest import bootstrap_admin, create_page, create_site, page_document


async def test_due_scheduled_snapshot_is_published_once(
    client: httpx.AsyncClient,
    app: FastAPI,
) -> None:
    admin = await bootstrap_admin(client)
    token = admin["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}
    site = await create_site(client, token)
    page = await create_page(
        client,
        token,
        site["id"],
        path="/scheduled",
        document=page_document("<p>Scheduled content</p>"),
    )
    scheduled = await client.post(
        f"/api/v1/pages/{page['id']}/schedule",
        headers=headers,
        json={
            "expectedVersion": 1,
            "runAt": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            "message": "Scheduled release",
        },
    )
    assert scheduled.status_code == 200, scheduled.text
    job_id = UUID(scheduled.json()["jobId"])

    async with app.state.database.session() as session:
        job = await session.get(PublishJob, job_id)
        assert job is not None
        job.run_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()

    await app.state.jobs.run_once()

    public = await client.get(
        "/api/v1/public/pages/by-path",
        params={"path": "/scheduled"},
    )
    assert public.status_code == 200, public.text
    assert (
        public.json()["document"]["blocks"][0]["children"][1]["props"]["html"]
        == "<p>Scheduled content</p>"
    )

    async with app.state.database.session() as session:
        completed = await session.get(PublishJob, job_id)
        assert completed is not None
        assert completed.status == JobStatus.SUCCEEDED.value
        attempts = completed.attempts

    await app.state.jobs.run_once()
    async with app.state.database.session() as session:
        unchanged = await session.get(PublishJob, job_id)
        assert unchanged is not None
        assert unchanged.attempts == attempts
