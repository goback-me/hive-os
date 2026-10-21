-- Main Slack channel + agency-wide ticks for main-channel Slack posts and automatic ClickUp tasks.
ALTER TABLE "IntegrationSettings" ADD COLUMN "automations" JSONB,
ADD COLUMN "slackAdminChannel" TEXT;
