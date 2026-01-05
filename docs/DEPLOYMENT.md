# Deployment Guide

## Overview

This guide provides step-by-step instructions for safely deploying changes to production.

**Key Principle:** Production runs from the `production-current` git tag pointing to the `deployment` branch. You can freely develop in `main` and other branches without affecting production.

---

## Branch Structure

This project uses a three-branch workflow:

### Branches
- **`main`** - Active development branch
  - Merge feature branches here
  - PRs target this branch
  - Safe to experiment and iterate

- **`deployment`** - Stable deployment branch
  - Contains production-ready code
  - Only receives tested changes from main
  - `production-current` tag points here
  - Cron jobs run from this branch via the tag

- **`feature/*`, `fix/*`, etc.** - Development branches
  - Created from main
  - Merged back to main via PR

### Tags
- **`production-current`** - Points to the stable commit on `deployment` branch
  - Cron job always checks out this tag
  - Moving this tag triggers deployment on next cron run (5:20 AM/PM)

### Workflow Summary
```
feature/* → main → deployment → production-current tag → cron execution
```

---

## Quick Reference

### Current State
- **Production Directory:** `/Users/tina/Projects/ambient-weather-heiligers`
- **Production Protection:** `production-current` git tag → `deployment` branch
- **Development Branch:** `main` (safe to merge to)
- **Deployment Branch:** `deployment` (stable, production-ready code)
- **Latest Production Release:** Run `git describe --tags production-current`
- **Cron Schedule:** 5:20 AM & 5:20 PM daily
- **Cron Log:** `logs/cron.log`
- **Cron Script:** `fetchAndIndex-production.sh` (always checks out `production-current` tag)

---

## How Production Protection Works

### The Cron Job

```bash
# From crontab -l:
20 5,17 * * * /Users/tina/Projects/ambient-weather-heiligers/fetchAndIndex-production.sh
```

### What the Production Script Does

```bash
# fetchAndIndex-production.sh:
1. Fetches latest tags from remote
2. Checks out production-current tag (detached HEAD)
3. Runs the indexing: source .env && node runMainIIFE.js
4. Returns to main branch
5. Logs output to logs/cron.log
```

**Result:** Even if `main` branch changes, production always runs from `production-current` tag.

---

## Development Workflow

### 1. Starting New Work

```bash
# Always start from latest main
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Making Changes

```bash
# Make your changes
# ...

# Test locally with both clusters
source .env
node runMainIIFE.js

# Run tests
npm test

# Commit frequently with clear messages
git add .
git commit -m "Clear description of changes"
```

### 3. Creating Pull Request

```bash
# Push feature branch
git push -u origin feature/your-feature-name

# Create PR targeting main
gh pr create --repo DrMrsMoo/ambient-weather-heiligers --base main

# Alternative: use GitHub web interface
```

### 4. After PR Approval

```bash
# Merge via GitHub (or CLI)
gh pr merge --squash  # or --merge, --rebase

# Delete feature branch
git branch -d feature/your-feature-name
git push origin --delete feature/your-feature-name
```

**IMPORTANT:** Merging to `main` does NOT deploy to production! Production is still running from the `production-current` tag.

---

## Deployment Process

### When to Deploy

Deploy when you have:
- ✅ One or more merged PRs in `main` ready for production
- ✅ All tests passing
- ✅ Changes tested locally
- ✅ CHANGELOG.md updated (optional but recommended)

**You control when deployment happens** - it's not automatic.

### Recommended Workflow

```bash
# Step 1: Merge main into deployment branch
git checkout deployment
git pull origin deployment
git merge origin/main

# Step 2: Test the deployment branch
source .env
node runMainIIFE.js
# Watch for success messages from both clusters

# Step 3: If tests pass, push deployment branch
git push origin deployment

# Step 4: Move production-current tag to deployment
git tag -f production-current deployment
git push origin production-current --force

# Step 5: Return to main
git checkout main
```

**Next cron run (5:20 AM or 5:20 PM) will use the new version.**

### Alternative: Using deploy-to-production.sh Script

The `deploy-to-production.sh` script automates testing and tag movement:

```bash
# Deploy latest deployment branch
./deploy-to-production.sh deployment

# OR deploy main directly (merges to deployment first)
./deploy-to-production.sh main

# OR deploy a specific tag
./deploy-to-production.sh v1.1.0
```

**What the script does:**
1. Shows you what commits will be deployed
2. Checks out the target version
3. Runs a test: `source .env && node runMainIIFE.js`
4. Asks for confirmation that test passed
5. Moves `production-current` tag to target version
6. Pushes tag to remote
7. Returns to `main` branch

### Quick Deployment (If deployment branch is up-to-date)

If `deployment` already has the changes you want:

```bash
# Just move the tag and push
git tag -f production-current deployment
git push origin production-current --force
```

### Option 3: Create Named Release Then Deploy

For major releases, create a named tag first:

```bash
# Step 1: Create and push release tag
git checkout main
git pull origin main
git tag -a v1.2.0 -m "Release v1.2.0: TypeScript migration

- Migrated core modules to TypeScript
- Improved type safety
- Updated tests for TS compatibility"
git push origin v1.2.0

# Step 2: Deploy using the script
./deploy-to-production.sh v1.2.0
```

---

## Monitoring Deployment

### Check What's Deployed

```bash
# See which commit production-current points to
git describe --tags production-current

# See what production-current contains
git show production-current

# Compare production to main
git log production-current..main --oneline
```

### Monitor Cron Execution

```bash
# Watch log in real-time (wait for 5:20 AM/PM)
tail -f logs/cron.log

# Check recent logs
tail -50 logs/cron.log

# Check for errors
tail -100 logs/cron.log | grep -i error
```

### Verify Data Indexing

```bash
# Run verification script
npm run verify-indexing

# Check for gaps
npm run check-staging-gaps
npm run check-prod-gaps
```

---

## Rollback Procedure

If a deployment causes issues, rollback is instant:

### Quick Rollback

```bash
# Find the previous working version
git log --oneline --decorate | grep production

# Move production-current back
git tag -f production-current <previous-commit-or-tag>
git push origin production-current --force

# Example: Rollback to v1.0.0
git tag -f production-current v1.0.0
git push origin production-current --force
```

**Next cron run will use the rolled-back version.**

### Verify Rollback

```bash
# Check what production points to
git describe --tags production-current

# Wait for next cron run and monitor
tail -f logs/cron.log
```

---

## Troubleshooting

### Issue: Production tag not found

```bash
# Recreate production-current tag
git tag production-current main
git push origin production-current

# Or point it to a known good commit
git tag production-current <commit-sha>
git push origin production-current
```

### Issue: Cron job not running

```bash
# Check cron is configured
crontab -l
# Should show: 20 5,17 * * * .../fetchAndIndex-production.sh

# Check cron logs
tail -50 logs/cron.log

# Check script permissions
ls -la fetchAndIndex-production.sh
# Should be executable (-rwxr-xr-x)

# Make executable if needed
chmod +x fetchAndIndex-production.sh
```

### Issue: Test succeeds locally but cron fails

```bash
# Check environment variables
cat .env | grep -v PASSWORD | grep -v KEY  # Don't expose secrets

# Verify Node version
/Users/tina/.nvm/versions/node/v23.5.0/bin/node --version

# Check if dependencies changed
npm list

# Reinstall if needed
npm clean-install
```

### Issue: Git detached HEAD warning

This is **normal and expected**! The production script intentionally checks out a tag (detached HEAD) to ensure stability. The script returns to `main` after running.

### Issue: Accidental merge to main

**Good news:** It doesn't matter! Since production runs from the `production-current` tag, accidental merges to `main` don't affect production. Just don't run the deployment script until you're ready.

---

## Best Practices

### DO:
- ✅ Test locally before creating PR
- ✅ Merge to `main` whenever PRs are approved
- ✅ Use the deployment script for safety
- ✅ Update CHANGELOG.md before deploying
- ✅ Monitor logs after deployment
- ✅ Create named tags for major releases

### DON'T:
- ❌ Don't manually edit `production-current` tag without testing
- ❌ Don't force-push to `main` (use PRs)
- ❌ Don't skip testing before deployment
- ❌ Don't deploy late at night (harder to monitor)
- ❌ Don't deploy multiple major changes at once

---

## Deployment Checklist

Before running `./deploy-to-production.sh`:

- [ ] All PRs merged to `main`
- [ ] `main` branch tested locally (npm test)
- [ ] `main` branch tested with live clusters (node runMainIIFE.js)
- [ ] CHANGELOG.md updated
- [ ] You can monitor next cron run (5:20 AM/PM)

After deployment:

- [ ] Cron run 1: Check logs for success
- [ ] Cron run 2: Verify continued stability
- [ ] No errors in logs
- [ ] Data indexed successfully (npm run verify-indexing)
- [ ] No gaps in data

---

## Deployment Log Template

Keep a deployment log in your notes:

```
=== Deployment to production-current ===
Date: 2026-01-05
Time: 14:30 UTC
Target: main (commit abc1234)

Changes:
- Added TypeScript support
- Improved logging
- Fixed bug in converter

Pre-deployment:
✅ Local tests passed
✅ Live cluster test successful
✅ Both clusters indexed data

Deployment:
✅ Ran deploy-to-production.sh
✅ Production-current moved to abc1234

Post-deployment:
✅ Cron run 1 (17:20): Success
✅ Cron run 2 (05:20): Success
✅ No errors in logs
✅ Data verified with npm run verify-indexing

Status: ✅ SUCCESSFUL
```

---

## Emergency Procedures

### Complete System Failure

If production is completely broken:

1. **Immediate Rollback:**
   ```bash
   # Rollback to last known good version
   git tag -f production-current v1.0.0
   git push origin production-current --force
   ```

2. **Verify Environment:**
   ```bash
   source .env
   node --version
   npm list
   ```

3. **Test Manually:**
   ```bash
   git checkout production-current
   source .env
   node runMainIIFE.js
   ```

4. **Check Logs:**
   ```bash
   tail -100 logs/cron.log
   ```

### If Git Tags Are Corrupted

```bash
# Delete corrupted tag
git tag -d production-current
git push origin :refs/tags/production-current

# Recreate from known good commit
git tag production-current <good-commit-sha>
git push origin production-current
```

---

## Understanding the System

### Key Files

| File | Purpose | Used By |
|------|---------|---------|
| `fetchAndIndex-production.sh` | Cron script that checks out tag | Crontab |
| `deploy-to-production.sh` | Manual deployment helper | You |
| `runMainIIFE.js` | Entry point for indexing | Both scripts |
| `main.js` | Core indexing logic | runMainIIFE.js |
| `.env` | Credentials and config | All scripts |
| `logs/cron.log` | Cron output | Monitoring |

### Git Tags

| Tag | Purpose | Mutable? |
|-----|---------|----------|
| `production-current` | What cron runs | YES - moved during deployment |
| `v1.0.0`, `v1.1.0`, etc. | Named releases | NO - immutable snapshots |

### Branches

| Branch | Purpose | Safe to Force-Push? |
|--------|---------|---------------------|
| `deployment` | Stable production code | NO - merge from main |
| `main` | Development integration | NO - use PRs |
| `feature/*` | Isolated work | YES - your branch |
| `pi-master` | Legacy (unused) | NO - kept for history |

---

## Troubleshooting

### Cron Job Not Running

**Symptom:** Cron job scheduled but no new data appearing in clusters

**Common Causes:**

1. **Wrong script path in crontab**
   ```bash
   # Check current crontab
   crontab -l

   # Should see:
   # 20 5,17 * * * /Users/tina/Projects/ambient-weather-heiligers/fetchAndIndex-production.sh

   # If script doesn't exist, update crontab:
   echo "20 5,17 * * * /Users/tina/Projects/ambient-weather-heiligers/fetchAndIndex-production.sh" | crontab -
   ```

2. **production-current tag missing or pointing to wrong commit**
   ```bash
   # Check tag exists
   git tag -l production-current

   # Check what it points to
   git describe --tags production-current
   git show production-current --no-patch

   # If missing, recreate:
   git tag production-current deployment
   git push origin production-current
   ```

3. **Script not executable**
   ```bash
   chmod +x /Users/tina/Projects/ambient-weather-heiligers/fetchAndIndex-production.sh
   ```

4. **Environment variables not loading**
   ```bash
   # Test script manually
   /Users/tina/Projects/ambient-weather-heiligers/fetchAndIndex-production.sh

   # Check logs for errors
   tail -50 logs/cron.log
   ```

### Historical Issue (Jan 5, 2026)

**What happened:** Cron job configured to run `fetchAndIndex-production.sh` but the file only existed on the `feature/reorganize-root-directory` branch, not on `main`. The script silently failed.

**Fix applied:**
1. Renamed `feature/reorganize-root-directory` → `deployment` branch
2. Pushed `deployment` branch to origin
3. Updated `production-current` tag to point to `deployment` branch
4. Verified crontab uses correct script path
5. Tested script execution successfully

**Lesson:** Always verify deployment scripts exist on the branch that cron will execute from.

### Cron Not Executing At All

```bash
# Check cron is running on macOS
sudo launchctl list | grep cron

# Check cron permissions (macOS may require Full Disk Access)
# System Preferences → Security & Privacy → Privacy → Full Disk Access
# Add Terminal or iTerm2

# Test cron with a simple entry first
echo "* * * * * date >> /tmp/crontest.log" | crontab -
# Wait 1 minute
cat /tmp/crontest.log
# If it works, restore original crontab
```

---

*Last updated: January 5, 2026*
