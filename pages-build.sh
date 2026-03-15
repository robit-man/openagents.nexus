#!/usr/bin/env bash
# Cloudflare Pages build script
# Only prepares static assets — does NOT compile the npm package
echo "OpenAgents Nexus — static site build"
echo "Static assets in public/ — no compilation needed"
echo "API functions in functions/ — auto-detected by Cloudflare"
ls -la public/
ls -la functions/api/v1/
echo "Build complete."
