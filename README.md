# Zero To Mastery (ZTM) Links

This repository contains links to [Zero To Mastery](https://zerotomastery.io) (ZTM) courses and career paths.

## Contents

- [`course.csv`](course.csv) — ZTM courses, with columns `course` (name) and `url`.
- [`path.csv`](path.csv) — ZTM career paths, with columns `path` (name) and `url`.
- [`academy.csv`](academy.csv) — ZTM Academy courses, with enrolled and public URLs.
- [`package.json`](package.json) and [`package-lock.json`](package-lock.json) — Node.js requirements, scripts, and locked dependencies.
- [`scripts/sync-courses.js`](scripts/sync-courses.js) and [`scripts/sync-courses.test.js`](scripts/sync-courses.test.js) — course scraper and its tests.
- [`.github/workflows/sync-courses.yml`](.github/workflows/sync-courses.yml) — scheduled and manually triggered course sync workflow.

## Course sync

Run `npm install` to install dependencies, `npm test` to run the tests, or `npm run sync` to update `academy.csv`. Node.js 20.18.1 or newer is required.
