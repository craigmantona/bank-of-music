# Historical artwork maintenance

The weekly discovery views do not need a scheduled refresh. The browser calculates the current Monday–Sunday week in `Europe/London`, including year boundaries and leap-day handling, from existing catalogue and chart data.

This workflow only checks whether Cover Art Archive has added a front cover to one of the exact commercial releases already approved by the historical artwork audits. It does not search by title or artist, call MusicBrainz, query Supabase, alter catalogue identities, or deploy the site.

## Activation

The workflow is intentionally manual-only. Run **Historical artwork maintenance** with the default 25-entry limit and review its report artifact. Once that succeeds, uncomment the `schedule` block. The proposed schedule is Sunday at 04:17 UTC, outside the user-facing weekly calculation and away from the top of the hour.

No repository secrets are required. GitHub's short-lived workflow token is limited to repository contents and pull requests. A pull request is created only when at least one uniquely verified cover is found; otherwise the run produces a 30-day report artifact.

## Safety and cost controls

- Maximum 25 chart entries and 100 Cover Art Archive requests per run.
- At least 1.1 seconds between external requests, with three retries only for transient responses.
- Previously missing artwork is checked at most every 90 days.
- Inaccessible responses retry after seven days.
- Multiple front covers stop in `REVIEW` and are not automatically retried until reviewed evidence changes.
- Existing static mappings are append-only and cannot be overwritten.
- The 74 candidates contain exact chart IDs, release-group MBIDs, and approved release MBIDs from the completed audits.
- Gracie Abrams — That's So True remains excluded.

The expected GitHub usage is about one minute of Linux runner time weekly while the queue is active, plus a small report artifact. The workflow uses no paid API and makes no database requests. GitHub-hosted runner and artifact usage remains subject to the repository account's plan.
