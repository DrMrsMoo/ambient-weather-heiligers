#!/bin/bash
# Diagnostic script for Raspberry Pi ambient-weather-heiligers installation
# Usage: bash scripts/check-pi-status.sh

echo "=========================================="
echo "  Raspberry Pi Status Check"
echo "  Ambient Weather Heiligers"
echo "=========================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "1. Current Directory and User:"
echo "   Directory: $(pwd)"
echo "   User: $(whoami)"
echo "   Expected: /home/pi/Projects/ambient-weather-heiligers (user: pi)"
echo ""

echo "2. Git Status:"
current_branch=$(git branch --show-current 2>/dev/null)
current_commit=$(git log --oneline -1 2>/dev/null | cut -d' ' -f1)
echo "   Branch: ${current_branch:-unknown}"
echo "   Commit: ${current_commit:-unknown}"
echo ""

echo "3. Production Tag Status:"
if git show-ref production-current >/dev/null 2>&1; then
    prod_tag_commit=$(git show-ref production-current | cut -d' ' -f1 | cut -c1-7)
    prod_tag_message=$(git log production-current --oneline -1 2>/dev/null)
    echo -e "   ${GREEN}✓${NC} production-current tag exists"
    echo "   Points to: $prod_tag_message"

    # Check if tag is up to date
    if [ "$prod_tag_commit" = "8db600b" ] || [ "$prod_tag_commit" = "8db600" ]; then
        echo -e "   ${GREEN}✓${NC} Tag includes newsyslog fix (8db600b)"
    else
        echo -e "   ${YELLOW}⚠${NC} Tag may be outdated (expected: 8db600b, got: $prod_tag_commit)"
        echo "   Run: git fetch --all --tags"
    fi
else
    echo -e "   ${RED}✗${NC} production-current tag NOT FOUND"
    echo "   Run: git fetch --all --tags"
fi
echo ""

echo "4. Log File Permissions:"
if [ -f logs/cron.log ]; then
    log_owner=$(stat -c '%U:%G' logs/cron.log 2>/dev/null || stat -f '%Su:%Sg' logs/cron.log 2>/dev/null)
    log_perms=$(stat -c '%a' logs/cron.log 2>/dev/null || stat -f '%Lp' logs/cron.log 2>/dev/null)

    if [ "$log_owner" = "pi:pi" ]; then
        echo -e "   ${GREEN}✓${NC} logs/cron.log owned by pi:pi"
    else
        echo -e "   ${RED}✗${NC} logs/cron.log owned by $log_owner (should be pi:pi)"
        echo "   Fix: sudo chown pi:pi logs/cron.log"
    fi
    echo "   Permissions: $log_perms"
    echo "   Size: $(du -h logs/cron.log | cut -f1)"
else
    echo -e "   ${YELLOW}⚠${NC} logs/cron.log does not exist"
fi
echo ""

echo "5. Most Recent Data Files:"
if [ -d data/ambient-weather-heiligers-imperial-jsonl ]; then
    latest_file=$(ls -t data/ambient-weather-heiligers-imperial-jsonl/*.jsonl 2>/dev/null | head -1)
    if [ -n "$latest_file" ]; then
        file_date=$(stat -c '%y' "$latest_file" 2>/dev/null | cut -d'.' -f1 || stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$latest_file" 2>/dev/null)
        filename=$(basename "$latest_file")

        # Extract timestamp from filename (format: timestamp_timestamp.jsonl)
        timestamp=$(echo "$filename" | cut -d'_' -f1)
        if command -v node >/dev/null 2>&1; then
            data_date=$(node -e "console.log(new Date($timestamp).toISOString())" 2>/dev/null)
            echo "   Latest file: $filename"
            echo "   Data timestamp: $data_date"
        else
            echo "   Latest file: $filename"
        fi
        echo "   File created: $file_date"

        # Check if file is recent (within last 24 hours)
        if [ -n "$(find data/ambient-weather-heiligers-imperial-jsonl -name "*.jsonl" -mtime -1 2>/dev/null)" ]; then
            echo -e "   ${GREEN}✓${NC} Recent data (< 24 hours old)"
        else
            echo -e "   ${RED}✗${NC} No recent data (> 24 hours old)"
        fi
    else
        echo -e "   ${RED}✗${NC} No data files found"
    fi
else
    echo -e "   ${RED}✗${NC} Data directory does not exist"
fi
echo ""

echo "6. Last 15 Lines of Cron Log:"
if [ -f logs/cron.log ]; then
    echo "   ----------------------------------------"
    tail -15 logs/cron.log | sed 's/^/   /'
    echo "   ----------------------------------------"
else
    echo -e "   ${YELLOW}⚠${NC} No cron log found"
fi
echo ""

echo "7. Cron Schedule:"
cron_entry=$(crontab -l 2>/dev/null | grep ambient-weather-heiligers)
if [ -n "$cron_entry" ]; then
    echo -e "   ${GREEN}✓${NC} Cron job configured:"
    echo "   $cron_entry"
else
    echo -e "   ${RED}✗${NC} No cron job found for ambient-weather-heiligers"
fi
echo ""

echo "8. Logrotate Configuration:"
if [ -f /etc/logrotate.d/ambient-weather ]; then
    echo -e "   ${GREEN}✓${NC} System config installed: /etc/logrotate.d/ambient-weather"

    # Check if it has ownership specified
    if grep -q "create.*pi pi" /etc/logrotate.d/ambient-weather 2>/dev/null; then
        echo -e "   ${GREEN}✓${NC} Ownership specified (pi:pi)"
    else
        echo -e "   ${YELLOW}⚠${NC} Ownership may not be specified"
    fi

    # Show last modified date
    if command -v stat >/dev/null 2>&1; then
        mod_date=$(stat -c '%y' /etc/logrotate.d/ambient-weather 2>/dev/null | cut -d'.' -f1 || stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' /etc/logrotate.d/ambient-weather 2>/dev/null)
        echo "   Last modified: $mod_date"
    fi
else
    echo -e "   ${RED}✗${NC} System config NOT installed"
    echo "   Install: sudo cp config/logrotate.d/ambient-weather /etc/logrotate.d/"
fi

# Check local config file
if [ -f config/logrotate.d/ambient-weather ]; then
    echo -e "   ${GREEN}✓${NC} Local config exists: config/logrotate.d/ambient-weather"
else
    echo -e "   ${RED}✗${NC} Local config missing"
fi
echo ""

echo "9. Environment Configuration:"
if [ -f .env ]; then
    if [ -r .env ]; then
        echo -e "   ${GREEN}✓${NC} .env file exists and is readable"

        # Check for required variables (without revealing values)
        required_vars=("AMBIENT_WEATHER_API_KEY" "AMBIENT_WEATHER_APPLICATION_KEY" "ES_CLOUD_ID" "STAGING_CLOUD_ID")
        missing_vars=()

        for var in "${required_vars[@]}"; do
            if ! grep -q "^${var}=" .env 2>/dev/null; then
                missing_vars+=("$var")
            fi
        done

        if [ ${#missing_vars[@]} -eq 0 ]; then
            echo -e "   ${GREEN}✓${NC} All required variables present"
        else
            echo -e "   ${YELLOW}⚠${NC} Missing variables: ${missing_vars[*]}"
        fi
    else
        echo -e "   ${RED}✗${NC} .env file exists but is not readable"
    fi
else
    echo -e "   ${RED}✗${NC} .env file does not exist"
fi
echo ""

echo "10. Recent Cron Executions (from syslog):"
if [ -f /var/log/syslog ]; then
    recent_runs=$(grep -i "cron.*ambient-weather" /var/log/syslog 2>/dev/null | tail -5)
    if [ -n "$recent_runs" ]; then
        echo "   Last 5 cron executions:"
        echo "$recent_runs" | sed 's/^/   /'
    else
        echo -e "   ${YELLOW}⚠${NC} No recent cron executions found in syslog"
        echo "   (This may be normal if no runs occurred recently)"
    fi
else
    echo -e "   ${YELLOW}⚠${NC} /var/log/syslog not accessible"
fi
echo ""

echo "=========================================="
echo "  Summary & Recommendations"
echo "=========================================="
echo ""

# Generate recommendations based on findings
recommendations=()

# Check for critical issues
if [ ! -f logs/cron.log ]; then
    recommendations+=("Create log directory: mkdir -p logs && touch logs/cron.log")
fi

if [ -f logs/cron.log ]; then
    log_owner=$(stat -c '%U:%G' logs/cron.log 2>/dev/null || stat -f '%Su:%Sg' logs/cron.log 2>/dev/null)
    if [ "$log_owner" != "pi:pi" ]; then
        recommendations+=("Fix log ownership: sudo chown pi:pi logs/cron.log")
    fi
fi

if ! git show-ref production-current >/dev/null 2>&1; then
    recommendations+=("Fetch production tag: git fetch --all --tags")
fi

if [ ! -f /etc/logrotate.d/ambient-weather ]; then
    recommendations+=("Install logrotate config: sudo cp config/logrotate.d/ambient-weather /etc/logrotate.d/")
fi

if [ -z "$cron_entry" ]; then
    recommendations+=("Add cron job: crontab -e")
fi

if [ ! -f .env ]; then
    recommendations+=("Create .env file: cp .env.example .env && nano .env")
fi

if [ ${#recommendations[@]} -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed! System appears healthy.${NC}"
    echo ""
    echo "Next steps:"
    echo "  - Monitor logs/cron.log for successful runs"
    echo "  - Verify data is being indexed to clusters"
else
    echo -e "${YELLOW}⚠ Issues found. Recommended actions:${NC}"
    echo ""
    for i in "${!recommendations[@]}"; do
        echo "  $((i+1)). ${recommendations[$i]}"
    done
fi

echo ""
echo "=========================================="
echo "  Check complete: $(date)"
echo "=========================================="
