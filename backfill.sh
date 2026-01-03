#!/bin/zsh
# Backfill script for Mac/local development
source $HOME/.zshrc
cd /Users/Tina/Projects/ambient-weather-heiligers
/Users/Tina/.nvm/versions/node/v16.13.1/bin/node runBackfill.js "$@"
