# Release Process

This document describes the automated release process for `@dav3/gql-of-power`.

## Branch Strategy

- **`main`**: Stable releases only. Always has a clean version number (e.g., `1.0.0`)
- **`develop`**: Active development. Has dev version (e.g., `1.1.0-dev`)

## Overview

The release process uses two GitHub Actions workflows:
1. **prepare-release.yml** — Initiates a release by creating a PR to main
2. **release.yml** — Publishes the release, merges back to develop, and bumps the dev version

## Version Strategy

We follow a **git-flow** versioning strategy:

| Bump Type | Main Version | Develop Version | Notes |
|-----------|--------------|-----------------|-------|
| **Patch** | `1.0.0` → `1.0.1` | `1.1.0-dev` (unchanged) | Hotfixes don't bump develop since it's already ahead |
| **Minor** | `1.0.0` → `1.1.0` | `1.1.0-dev` → `1.2.0-dev` | Develop moves to next minor |
| **Major** | `1.0.0` → `2.0.0` | `1.1.0-dev` → `3.0.0-dev` | Develop moves to next major |

## Daily Development

1. Work on the `develop` branch
2. Commit and push changes as usual
3. The version in `package.json` stays as `X.Y.Z-dev`
4. All changes accumulate until you're ready to release

## How to Release

### 1. Prepare Release

From the GitHub Actions tab, run the **"Prepare Release"** workflow:

1. Go to Actions → Prepare Release → Run workflow
2. Select `develop` branch
3. Choose version bump type:
   - **patch**: Bug fixes, small changes (e.g., `1.0.0` → `1.0.1`)
   - **minor**: New features, backward-compatible (e.g., `1.0.0` → `1.1.0`)
   - **major**: Breaking changes (e.g., `1.0.0` → `2.0.0`)
4. Click "Run workflow"

This will:
- Create a release branch from develop (e.g., `release/1.2.0`)
- Update `package.json` to the release version (stripping `-dev` and bumping)
- Create a PR to `main` with the `release:<type>` label

### 2. Review and Merge

1. Review the automatically created PR to `main`
2. Run any final checks/tests
3. Merge the PR to `main`

### 3. Automatic Release

Once merged to `main`, the **Release** workflow automatically:
1. Checks out `main` and runs build + tests
2. Publishes to npm
3. Creates a git tag and GitHub Release
4. Merges `main` back into `develop`
5. Bumps `develop` to the next `-dev` version (minor/major only; patch leaves develop as-is)

### Manual Release (Hotfix)

For emergency hotfixes directly on `main`:
1. Create a hotfix branch from `main`
2. Make your changes
3. Create a PR to `main` with label `release:patch`
4. Merge the PR — the release workflow will automatically publish and merge back to develop

### Manual Release (workflow_dispatch)

You can also trigger the release workflow manually:
1. Go to Actions → Release → Run workflow
2. Select branch: `main`
3. Choose version bump type
4. This publishes the current version on `main`, then merges back to develop and bumps

## Examples

### Scenario 1: Feature Release (Minor)

**Initial state:**
- `main`: `1.0.0`
- `develop`: `1.1.0-dev`

**Steps:**
1. Run "Prepare Release" with `minor` bump
2. PR created: `release/1.1.0` → `main`
3. Merge PR to `main`

**Automatic:**
- `main` tagged as `v1.1.0`, published to npm
- `develop` merged with `main`, bumped to `1.2.0-dev`

**Final state:**
- `main`: `1.1.0`
- `develop`: `1.2.0-dev`

### Scenario 2: Hotfix (Patch)

**Initial state:**
- `main`: `1.1.0`
- `develop`: `1.2.0-dev`

**Steps:**
1. Fix critical bug on `main`
2. Run "Prepare Release" with `patch` bump
3. PR created: `release/1.1.1` → `main`
4. Merge PR to `main`

**Automatic:**
- `main` tagged as `v1.1.1`, published to npm
- `develop` merged with `main`, version unchanged (`1.2.0-dev`)

**Final state:**
- `main`: `1.1.1`
- `develop`: `1.2.0-dev`

### Scenario 3: Breaking Change (Major)

**Initial state:**
- `main`: `1.5.0`
- `develop`: `1.6.0-dev`

**Steps:**
1. Run "Prepare Release" with `major` bump
2. PR created: `release/2.0.0` → `main`
3. Merge PR to `main`

**Automatic:**
- `main` tagged as `v2.0.0`, published to npm
- `develop` merged with `main`, bumped to `3.0.0-dev`

**Final state:**
- `main`: `2.0.0`
- `develop`: `3.0.0-dev`

## Troubleshooting

### Release workflow fails on npm publish
- Verify the npm trusted publisher is configured correctly (org, repo, workflow filename: `release.yml`, environment: `release`)
- Ensure you have publish permissions for the `@dav3` scope on npm
- Check that `id-token: write` permission is set in the workflow

### Develop version bump PR conflicts
- This can happen if develop has diverged significantly
- Manually resolve conflicts and merge
- The version in `package.json` should reflect the next version with `-dev` suffix

### Wrong version bump type used
- If you haven't merged to `main` yet, close the PR and create a new one
- If already released, create a new release with the correct version

## Configuration

### npm Publishing
- Uses **trusted publishers** (OIDC) — no `NPM_TOKEN` secret needed
- Requires Node.js ≥ 22.14.0 (currently `'24'` in workflow)
- Provenance is auto-generated by npm when publishing from a public repo

### Required Branch Protection (Recommended)
- `main`: Require PR reviews, passing status checks
- `develop`: Require PR reviews

### GitHub Actions Permissions
Both workflows require:
- `contents: write` — For tagging and pushing commits
- `pull-requests: write` — For creating PRs
- `id-token: write` — For npm trusted publishers (OIDC)
