# Release Workflow

## Branch Strategy

- **`main`**: Stable releases only. Always has a clean version number (e.g., `1.0.0`)
- **`develop`**: Active development. Has dev version (e.g., `1.1.0-dev`)

## Daily Development

1. Work on the `develop` branch
2. Commit and push changes as usual
3. The version in `package.json` stays as `X.Y.Z-dev`
4. All changes accumulate until you're ready to release

## Creating a Release

When you're ready to release all accumulated changes:

1. **Create a PR from develop to main**:
   ```bash
   git checkout develop
   git push origin develop
   # Then create PR on GitHub from develop → main
   ```

2. **Add a release label to the PR**:
   - `release:patch` - Bug fixes (1.0.0 → 1.0.1)
   - `release:minor` - New features (1.0.0 → 1.1.0)
   - `release:major` - Breaking changes (1.0.0 → 2.0.0)

3. **Merge the PR**:
   - Once approved and merged, the release workflow triggers automatically

4. **What happens automatically**:
   - Builds and tests the code
   - Updates `package.json` on `main` to new version (e.g., `1.1.0`)
   - Creates git tag (e.g., `v1.1.0`)
   - Creates GitHub Release
   - Merges `main` back into `develop`
   - Updates `develop` to next dev version (e.g., `1.2.0-dev`)

## Manual Release (Alternative)

You can also trigger releases manually without a PR:

1. Go to GitHub → Actions → "Release" workflow
2. Click "Run workflow"
3. Select branch: `main`
4. Choose version bump type
5. Click "Run workflow"

## Version States

- `main` branch: Always has stable versions (`1.0.0`, `1.1.0`, etc.)
- `develop` branch: Always has dev versions (`1.1.0-dev`, `1.2.0-dev`, etc.)
- This ensures users can distinguish stable from unstable code

## Initial Setup

If you don't have a `develop` branch yet:

```bash
git checkout -b develop
git push -u origin develop
```

Update the version to a dev version:
```bash
# Edit package.json version to "1.1.0-dev" (or appropriate version)
git add package.json
git commit -m "chore: initialize develop branch with dev version"
git push
```
