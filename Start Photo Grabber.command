#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Opening the download page..."
  echo "Install the LTS version, then double-click this file again."
  open https://nodejs.org
  read -p "Press Enter to close"
  exit 1
fi
[ -d node_modules ] || { echo "First run: installing, this takes about a minute..."; npm install; }
npm start
