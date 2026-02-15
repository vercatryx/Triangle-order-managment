#!/bin/bash
# Test look_up_client API locally
# Usage: ./scripts/test-retell-lookup-local.sh [phone]
# Requires: dev server running (npm run dev), RETELL_SKIP_VERIFY=true in .env.local

PHONE="${1:-8457826353}"
URL="${2:-http://localhost:3000}"

echo "Testing look_up_client at ${URL}/api/retell/look-up-client"
echo "Phone: $PHONE"
echo ""

curl -s -X POST "${URL}/api/retell/look-up-client" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"look_up_client\",\"args\":{\"phone_number\":\"$PHONE\"},\"call\":{}}" | (jq . 2>/dev/null || cat)
