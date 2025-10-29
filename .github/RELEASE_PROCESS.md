# Release Process

This document describes the automated release process for `@dav3/gql-of-power`.

## Overview

The release process uses two GitHub Actions workflows:
1. **prepare-release.yml** - Initiates a release by creating a PR to main
2. **release.yml** - Publishes the release and manages version bumping

## Version Strategy

We follow a **git-flow** versioning strategy:
- **`main` branch**: Stable releases (e.g., `1.2.0`, `1.2.1`)
- **`develop` branch**: Next minor version in development (e.g., `1.3.0-dev`)

### Version Bump Rules

| Bump Type | Main Version | Develop Version | Notes |
|-----------|--------------|-----------------|-------|
| **Patch** | `1.0.0` → `1.0.1` | `1.1.0-dev` (unchanged) | Hotfixes don't bump develop since it's already ahead |
| **Minor** | `1.0.0` → `1.1.0` | `1.1.0-dev` → `1.2.0-dev` | Develop moves to next minor |
| **Major** | `1.0.0` → `2.0.0` | `1.1.0-dev` → `2.1.0-dev` | Develop moves to next minor of new major |

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
- Update `package.json` to the release version
- Create a PR to `main` with the `release:<type>` label

### 2. Review and Merge

1. Review the automatically created PR to `main`
2. Run any final checks/tests
3. Merge the PR to `main`

### 3. Automatic Release

Once merged to `main`, the **Release** workflow automatically:
1. ✅ Tags the release (e.g., `v1.2.0`)
2. ✅ Publishes to npm
3. ✅ Creates a GitHub Release
4. ✅ Merges changes back to `develop`
5. ✅ Creates a PR to bump `develop` to the next version (if needed)

### 4. Merge Develop Version Bump

For **minor** and **major** releases, a PR will be created to bump develop:
- Review the version bump PR
- Merge to `develop` when ready

For **patch** releases, no PR is created since develop is already ahead.

## Manual Release (Hotfix)

For emergency hotfixes directly on `main`:

1. Create a hotfix branch from `main`
2. Make your changes
3. Create a PR to `main` with label `release:patch`
4. Merge the PR
5. The release workflow will automatically publish and manage versions

## Examples

### Scenario 1: Feature Release (Minor)

**Initial state:**
- `main`: `1.0.0`
- `develop`: `1.1.0-dev`

**Steps:**
1. Run "Prepare Release" with `minor` bump
2. PR created: `release/1.1.0` → `main`
3. Merge PR to `main`
4. Automatic:
   - `main` tagged as `v1.1.0`
   - Published to npm
   - PR created: `develop` bumped to `1.2.0-dev`

**Final state:**
- `main`: `1.1.0`
- `develop`: `1.2.0-dev` (after merging PR)

### Scenario 2: Hotfix (Patch)

**Initial state:**
- `main`: `1.1.0`
- `develop`: `1.2.0-dev`

**Steps:**
1. Fix critical bug on `main`
2. Run "Prepare Release" with `patch` bump
3. PR created: `release/1.1.1` → `main`
4. Merge PR to `main`
5. Automatic:
   - `main` tagged as `v1.1.1`
   - Published to npm
   - Changes merged to `develop`
   - **No version bump PR** (develop already ahead)

**Final state:**
- `main`: `1.1.1`
- `develop`: `1.2.0-dev` (unchanged, still ahead)

### Scenario 3: Breaking Change (Major)

**Initial state:**
- `main`: `1.5.0`
- `develop`: `1.6.0-dev`

**Steps:**
1. Run "Prepare Release" with `major` bump
2. PR created: `release/2.0.0` → `main`
3. Merge PR to `main`
4. Automatic:
   - `main` tagged as `v2.0.0`
   - Published to npm
   - PR created: `develop` bumped to `2.1.0-dev`

**Final state:**
- `main`: `2.0.0`
- `develop`: `2.1.0-dev` (after merging PR)

## Troubleshooting

### Release workflow fails on npm publish
- Check that `NPM_TOKEN` secret is configured in GitHub Settings → Secrets
- Verify you have publish permissions for the `@dav3` scope on npm

### Develop version bump PR conflicts
- This can happen if develop has diverged significantly
- Manually resolve conflicts and merge
- The version in `package.json` should reflect the next minor version

### Wrong version bump type used
- If you haven't merged to `main` yet, close the PR and create a new one
- If already released, create a new release with the correct version

## Configuration

### Required GitHub Secrets
- `NPM_TOKEN`: npm authentication token with publish permissions

### Required Branch Protection (Recommended)
- `main`: Require PR reviews, passing status checks
- `develop`: Require PR reviews

### GitHub Actions Permissions
Both workflows require:
- `contents: write` - For tagging and pushing commits
- `pull-requests: write` - For creating PRs
- `id-token: write` - For npm provenance (release workflow)
