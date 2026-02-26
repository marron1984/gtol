#!/bin/bash
# Deploy cal-sync to Google Cloud Run.
#
# Prerequisites:
#   - gcloud CLI authenticated
#   - Docker image built and pushed to Artifact Registry

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-northeast1}"
IMAGE="${IMAGE:?Set IMAGE (e.g. asia-northeast1-docker.pkg.dev/PROJECT/repo/cal-sync:latest)}"

gcloud run deploy cal-sync \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --no-allow-unauthenticated \
  --port=8080 \
  --memory=256Mi \
  --min-instances=0 \
  --max-instances=3 \
  --set-env-vars="\
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID},\
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET},\
GOOGLE_REFRESH_TOKEN=${GOOGLE_REFRESH_TOKEN},\
GOOGLE_CALENDAR_ID=${GOOGLE_CALENDAR_ID:-primary},\
LW_CLIENT_ID=${LW_CLIENT_ID},\
LW_CLIENT_SECRET=${LW_CLIENT_SECRET},\
LW_REFRESH_TOKEN=${LW_REFRESH_TOKEN},\
LW_BOT_ID=${LW_BOT_ID},\
LW_CHANNEL_ID=${LW_CHANNEL_ID},\
LW_CALENDAR_ID=${LW_CALENDAR_ID},\
LW_WEBHOOK_SECRET=${LW_WEBHOOK_SECRET},\
SYNC_USER_ID=${SYNC_USER_ID:-yoshida},\
FIRESTORE_PROJECT_ID=${PROJECT_ID}" \
  --project="$PROJECT_ID"

echo ""
echo "Deployment complete. Get the service URL with:"
echo "  gcloud run services describe cal-sync --region=$REGION --format='value(status.url)'"
