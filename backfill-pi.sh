#!/bin/bash
# Backfill script for Raspberry Pi
cd /home/pi/Projects/ambient-weather-heiligers
source .env
/usr/bin/node runBackfill.js "$@"
