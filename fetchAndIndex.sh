#!/bin/zsh
# Wrapper script for running on Mac (NOT USED ON PI)
cd /Users/tina/Projects/ambient-weather-heiligers
source .env
/Users/tina/.nvm/versions/node/v23.5.0/bin/node runMainIIFE.js >> logs/cron.log 2>&1
