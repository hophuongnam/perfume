#!/bin/bash

# Check if Python 3.9 is installed
if ! command -v python3.9 &> /dev/null; then
    echo "Python 3.9 is not installed. Please install Python 3.9 and try again."
    exit 1
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment with Python 3.9..."
    python3.9 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate


# Run the application
python /Users/namhp/Resilio.Sync/project_analyzer/project_analyzer.py -d /Users/namhp/Resilio.Sync/Perfume.Server  -i --no-metadata --format xml --languages javascript
