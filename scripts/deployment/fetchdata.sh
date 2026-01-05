#!/bin/zsh
# NOT USED - kept for reference
source $HOME/.zshrc
cd /Users/Tina/Projects/ambient-weather-heiligers
/Users/Tina/.nvm/versions/node/v16.13.1/bin/node bin/runFetchRawData.js && /Users/Tina/.nvm/versions/node/v16.13.1/bin/node bin/runConvertImperialToJsonl.js && /Users/Tina/.nvm/versions/node/v16.13.1/bin/node bin/runConvertImperialToMetric.js
