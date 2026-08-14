# User guide

The final labels and URLs depend on the frontend implementation. This guide
defines expected behavior for acceptance and training.

## Create and edit a page

1. Sign in through the approved identity provider.
2. Open the Page Builder and create a page, or select a page you may edit.
3. Enter required page metadata and assemble content from approved blocks.
4. Save the draft. A visible status should distinguish unsaved, saved,
   validating, conflicted, and failed states.
5. Preview the exact revision you intend to publish at supported viewport
   sizes.

Drafts are not public. If another editor changes the same revision, the builder
must show a conflict and preserve both users' work; do not overwrite blindly.

## Media

Upload only permitted file types and content. Provide useful alternative text
for informative images; mark decorative images accordingly. An item is usable
only after upload, validation, and any security scanning complete.

Do not reuse temporary upload URLs. The builder should store a stable media
identifier and render a finalized public URL.

## Publish and roll back

Publishing requires the publish capability and may require approval. Review
validation errors, canonical URL, schedule, and preview before confirming.
Repeated clicks must not create duplicate publications.

For a scheduled publication, verify the displayed timezone and UTC time. A
successful request may remain pending while a background job runs. Use job
status rather than assuming submission means completion.

Rollback creates or selects a known-good revision; it does not erase audit
history. Contact an administrator if the builder route or publishing feature
has been disabled during an incident.

## Accessibility and content quality

Use semantic headings in order, descriptive links, captions where required,
sufficient color contrast, keyboard-operable components, and meaningful form
labels. Automated checks catch only part of accessibility compliance; perform
keyboard and screen-reader review for release-critical templates.

## When something fails

- Copy the request/correlation ID and UTC time shown by the UI.
- Preserve the draft; do not repeatedly submit a failing publish request.
- For a conflict, reload the latest revision and intentionally merge changes.
- For a rejected upload, check type, size, filename, and content policy.
- For an outage or incorrect public page, contact an administrator with the
  page ID, revision, public URL, and last known-good revision.
