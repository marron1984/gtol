#!/bin/bash
# Cloud Scheduler job configuration for cal-sync polling.
# Run this script after deploying to Cloud Run.
#
# Prerequisites:
#   - gcloud CLI authenticated
#   - Cloud Run service deployed as "cal-sync"
#   - Cloud Scheduler API enabled

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-northeast1}"
SERVICE_URL="${SERVICE_URL:?Set SERVICE_URL (Cloud Run service URL)}"
SYNC_USER_ID="${SYNC_USER_ID:-yoshida}"

# Create a service account for Cloud Scheduler → Cloud Run invocation
gcloud iam service-accounts create cal-sync-scheduler \
  --display-name="cal-sync Cloud Scheduler" \
  --project="$PROJECT_ID" 2>/dev/null || true

SA_EMAIL="cal-sync-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant the service account permission to invoke Cloud Run
gcloud run services add-iam-policy-binding cal-sync \
  --region="$REGION" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.invoker" \
  --project="$PROJECT_ID"

# Create the polling job (every 10 minutes)
gcloud scheduler jobs create http cal-sync-poll \
  --location="$REGION" \
  --schedule="*/10 * * * *" \
  --uri="${SERVICE_URL}/poll" \
  --http-method=POST \
  --headers="Content-Type=application/json" \
  --message-body="{\"userId\":\"${SYNC_USER_ID}\",\"baseUrl\":\"${SERVICE_URL}\"}" \
  --oidc-service-account-email="$SA_EMAIL" \
  --oidc-token-audience="$SERVICE_URL" \
  --project="$PROJECT_ID" \
  --time-zone="Asia/Tokyo"

echo "Cloud Scheduler job 'cal-sync-poll' created."
echo "  Schedule: every 10 minutes"
echo "  Target:   ${SERVICE_URL}/poll"
