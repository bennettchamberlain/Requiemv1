# Running CI for this repo

Automatic workflow triggers in this repository are **gated**: pushing does not
start a GitHub-hosted run any more. Checks run on local hardware, and the
workflows that remain are started deliberately.

Why: GitHub Actions was costing the org $563/month, almost all of it hosted
compute for checks that run just as well on hardware we already own.

Starting a gated workflow needs the [`gh` CLI](https://cli.github.com) and push
access. `--ref` matters - the workflow file is read from that branch, so a
workflow that only exists on your feature branch must be dispatched against it.

Full cross-repo runbook: `CI-Local-CICD/RUNBOOK.md` (regenerate with
`ci-local docs`). Everything above and below the two rules is generated - do not
hand-edit it; the block between them is maintained by hand and a regeneration
will drop it.

`ci-local` is not on `PATH` by default. It is the script at
`CI-Local-CICD/ci-local` in the sibling clone - invoke it by full path, or add
that directory to `PATH`.

---

## Not covered by the generated list below (hand-maintained, verified 2026-08-23)

The generated section lists five of this repo's **ten** workflows. The other
five, and the two places where "pushing does not start a GitHub-hosted run" is
no longer true:

| Workflow | Trigger | Note |
|---|---|---|
| `codeql.yml` | **`push` + `pull_request` on `main`, plus a Monday cron** | NOT gated. Added 2026-08-23 in [#2261](https://github.com/companionintelligence/CI-Server/pull/2261). **Fails on every run**: the analysis completes, then the upload is rejected with `Code Security must be enabled for this repository to use code scanning`. Red is the baseline here until Code Security is enabled on the repo. |
| `mobile-release.yml` | **`push` on `ios-v*` / `android-v*` / `mobile-release-v*` tags**, plus dispatch | NOT gated for tags. Never runs on a PR. |
| `consent-path-gate.yml` | `workflow_dispatch` | The merge gate for the federated-ask consent path. `gh workflow run "Consent path gate" --ref <branch>`. Ships dispatch-only on purpose - see [`asks-system-guide.md` §7.3](asks-system-guide.md). |
| `mobile-build.yml` | `workflow_dispatch` | Debug APK + iOS Simulator `.app`. |
| `xcode-cloud-manual-only.yml` | `workflow_dispatch` | One-shot: strips App Store Connect's automatic start conditions so `App \| BuildTestFlight` stops firing on every PR. Needs the `APPSTORE_*` secrets. Until someone dispatches it, that check is still red on every PR. |

**Xcode Cloud is not a GitHub Actions workflow** and so is not gated by any of
the above. `App | BuildTestFlight` reports on PRs from App Store Connect and is
failing - baseline, not your change.

---

Default branch: `main`

### Test locally

```bash
ci-local run --repo CI-Server
```

Equivalent to:

```bash
yarn install --immutable
yarn run lint
```

### Run a check workflow on GitHub

**CI** — `ci.yml`

```bash
gh workflow run ci.yml --repo companionintelligence/CI-Server --ref main
```

**E2E** — `e2e.yml`

```bash
gh workflow run e2e.yml --repo companionintelligence/CI-Server --ref main
```

**Migrations** — `migration-integrity-check.yml`

```bash
gh workflow run migration-integrity-check.yml --repo companionintelligence/CI-Server --ref main
```

**Style canon lint** — `style-canon-lint.yml`

```bash
gh workflow run style-canon-lint.yml --repo companionintelligence/CI-Server --ref main
```

### Cut a release

**Publish** — `publish.yml`

```bash
gh workflow run publish.yml --repo companionintelligence/CI-Server --ref main
```
