# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive modernization plan (REFACTOR_PLAN.md)
- CHANGELOG.md for tracking releases
- Safe deployment strategy documentation

### Changed
- Updated REFACTOR_PLAN.md with epic-based approach

## [1.0.0] - 2026-01-04 (Current `main` branch state)

### Added
- Dual-cluster indexing (production + staging) with independent error handling
- Factory pattern for Elasticsearch client creation (`createEsClient`)
- Backfill CLI with flexible cluster targeting (`--prod`, `--staging`, `--both`)
- Comprehensive verification and gap analysis scripts
- Local-first data sourcing with automatic JSONL conversion
- Project constitution (CLAUDE.md)
- Extensive documentation and testing guides

### Changed
- Migrated from single cluster to dual-cluster architecture
- Improved error handling using `Promise.allSettled()` for cluster independence
- Enhanced logging with ISO timestamps at major milestones
- Updated README with backfill documentation

### Fixed
- Cluster isolation - one cluster failure doesn't affect the other
- Data preparation bugs in `main_utils.js`
- Removed dead code from legacy implementations

### Security
- Environment variables properly isolated per cluster

## [0.9.0] - 2025-12-01 (Approximate, pre-dual-cluster)

### Added
- Basic weather data fetching from Ambient Weather API
- Imperial to metric conversion
- JSONL file conversion
- Elasticsearch indexing

### Changed
- Initial Node.js implementation

---

## Release Guidelines

### Version Numbering (SemVer)
- **MAJOR (X.0.0)**: Breaking changes, incompatible API changes
- **MINOR (0.X.0)**: New features, backward-compatible
- **PATCH (0.0.X)**: Bug fixes, backward-compatible

### When to Create a Release

Create a new tagged release when:
1. You've merged significant features to `main`
2. You've fixed critical bugs
3. You're ready to test on Raspberry Pi
4. You want to create a stable snapshot before major refactoring

### Release Checklist

Before creating a tag:
- [ ] All tests passing on `main`
- [ ] CHANGELOG.md updated with changes
- [ ] Version number decided (SemVer)
- [ ] Tested locally with both clusters
- [ ] Documentation updated if needed

### Creating a Release

```bash
# On main branch
git checkout main
git pull origin main

# Create annotated tag
git tag -a v1.1.0 -m "Release v1.1.0: Add TypeScript support

- Migrated core modules to TypeScript
- Improved type safety
- Updated tests for TS compatibility"

# Push tag to remote
git push origin v1.1.0

# Create GitHub release (optional)
gh release create v1.1.0 --title "v1.1.0: TypeScript Migration" --notes "See CHANGELOG.md for details"
```

### Deploying to Raspberry Pi

See REFACTOR_PLAN.md "Deployment Process" section for full instructions.

Quick reference:
```bash
# On Pi
git fetch --all --tags
git checkout tags/v1.1.0 -b temp-release-test
source .env && node runMainIIFE.js  # Test

# If successful
git checkout pi-master
git merge v1.1.0
```

---

## Historical Notes

### Production Branch (`pi-master`)
The `pi-master` branch tracks what's deployed on the Raspberry Pi. It may lag behind `main` as we test and stabilize features before deployment.

### Development Branch (`main`)
The `main` branch is the integration branch for all feature work. All PRs merge here first.

---

*Last updated: January 4, 2026*
