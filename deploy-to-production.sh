#!/bin/zsh
# Deploy script - moves production tag to trigger deployment
# Usage: ./deploy-to-production.sh [git-ref]
# Example: ./deploy-to-production.sh main
# Example: ./deploy-to-production.sh v1.2.0

set -e

REPO_DIR="/Users/tina/Projects/ambient-weather-heiligers"
TARGET_REF="${1:-main}"

cd "$REPO_DIR"

echo "🔍 Checking current production tag..."
CURRENT_PROD=$(git describe --tags --exact-match production-current 2>/dev/null || echo "none")
echo "Current production: $CURRENT_PROD"

echo ""
echo "🎯 Target deployment: $TARGET_REF"
git fetch --all --tags

echo ""
echo "📋 Changes to be deployed:"
if [ "$CURRENT_PROD" != "none" ]; then
    git log --oneline "$CURRENT_PROD..$TARGET_REF" | head -10
else
    git log --oneline "$TARGET_REF" -5
fi

echo ""
read "CONFIRM?⚠️  Deploy $TARGET_REF to production? (yes/no): "

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

echo ""
echo "🧪 Testing target version..."
git checkout "$TARGET_REF"
source .env
/Users/tina/.nvm/versions/node/v23.5.0/bin/node runMainIIFE.js

echo ""
read "TEST_OK?✅ Did the test run succeed? (yes/no): "

if [ "$TEST_OK" != "yes" ]; then
    echo "❌ Deployment cancelled - test failed"
    git checkout main
    exit 1
fi

echo ""
echo "🏷️  Moving production-current tag to $TARGET_REF..."
git tag -f production-current "$TARGET_REF"
git push origin production-current --force

echo ""
echo "✅ Deployment complete!"
echo "Next cron run (5:20 AM/PM) will use: $TARGET_REF"
echo ""
echo "Monitor logs: tail -f logs/cron.log"

git checkout main
