#!/usr/bin/env bash
set -e

cd backend
npm install
PORT=5001 node index.js &

cd ../frontend
npm install
EXPO_PUBLIC_API_BASE_URL=http://localhost:5001 npx expo start
