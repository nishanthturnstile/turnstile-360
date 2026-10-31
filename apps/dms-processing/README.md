# Thaarei DMS processing

Python processing project for the Thaarei Document Management System. Publisher, tasks,
job API, transfers, processors, and sandbox folders define its execution boundaries.
Worker execution, parsers, and broker connections follow their processing requirements;
the current command prints the processing application's identity and exits.

Use root `pnpm build`, `pnpm check:python`, and `pnpm test`. The Python test task checks
the installed entry point. pytest is available for tests accompanying processing
behavior. Python 3.13.18 is pinned locally.

This is proprietary Thaarei software. The included LICENSE applies to this package.
