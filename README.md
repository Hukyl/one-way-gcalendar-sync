# One-Way Google Calendar Sync

## Overview

This Google Apps Script syncs events **one-way** from a source calendar to your primary calendar. Events created in the destination calendar will NOT sync back to the source. The script also properly handles recurring events.

## Quick Setup (5 minutes)

### Step 1: Prepare Your Calendars

1. **In your SOURCE account** (the one with events to copy):
   - Go to [Google Calendar](https://calendar.google.com)
   - Click the ⋮ menu next to your calendar → **Settings and sharing**
   - Under "Share with specific people", click **+ Add people**
   - Add your DESTINATION account email
   - Set permission to **"See all event details"**
   - Click **Send**

2. **Get the Source Calendar ID**:
   - In the same settings page, scroll to **"Integrate calendar"**
   - Copy the **Calendar ID** (looks like `example@gmail.com` or `abc123@group.calendar.google.com`)

3. **In your DESTINATION account** (where you want events copied TO):
   - In your Google Calendar, press + button near "Other calendars"
   - Choose "Subscribe to calendar"
   - Paste the Source Calendar ID
   - Click "Subscribe"

   Note: this is required for the script to be able to access the source calendar.

### Step 2: Set Up the Script

1. **In your DESTINATION account** (where you want events copied TO):
   - Go to [script.google.com](https://script.google.com)
   - Click **New Project**
   - Delete any existing code
   - Paste the entire contents of `OneWayCalendarSync.gs`

2. **Configure the script** (via Script Properties):
   - Click the **gear icon** (Project Settings) in the left sidebar
   - Scroll down to **Script Properties**
   - Click **Add script property** and add:
     - `SOURCE_CALENDAR_ID` = your source calendar ID (required)
   - Optionally add these properties to customize behavior:
     - `DESTINATION_CALENDAR_ID` = target calendar (default: `primary`)
     - `SYNC_DAYS_PAST` = days back to sync (default: `7`)
     - `SYNC_DAYS_FUTURE` = days ahead to sync (default: `60`)
     - `SYNC_DETAILS` = copy description/location (default: `true`)
     - `DELETE_REMOVED_EVENTS` = delete when removed from source (default: `true`)

3. **Save the project** (Ctrl+S or Cmd+S)

### Step 3: Authorize and Test

1. **Run the test function**:
   - Select `testConfiguration` from the function dropdown
   - Click **Run**
   - When prompted, click **Review Permissions**
   - Select your account and click **Allow**
   - Check the execution log for success messages

2. **Run initial sync**:
   - Select `initialSync` from the dropdown
   - Click **Run**
   - Check your destination calendar - events should appear!

### Step 4: Enable Automatic Syncing

1. Select `setupTrigger` from the dropdown
2. Click **Run**
3. The script will now run automatically every 15 minutes

---

## Configuration Options (Script Properties)

Configuration is stored in **Script Properties** (not in the code), so you can safely commit the script to git without exposing your calendar IDs.

To edit: **Project Settings** (gear icon) → **Script Properties**

| Property | Default | Description |
|----------|---------|-------------|
| `SOURCE_CALENDAR_ID` | (required) | Calendar ID of the source calendar |
| `DESTINATION_CALENDAR_ID` | `primary` | Usually leave as 'primary' for main calendar |
| `SYNC_DAYS_PAST` | `7` | Days in the past to sync |
| `SYNC_DAYS_FUTURE` | `60` | Days in the future to sync |
| `SYNC_DETAILS` | `true` | Copy description and location (`true`/`false`) |
| `COPY_ATTENDEES` | `false` | Copy attendees to synced events (`true`/`false`) |
| `DELETE_REMOVED_EVENTS` | `true` | Delete events when removed from source (`true`/`false`) |

---

## Available Functions

| Function | Purpose |
|----------|---------|
| `testConfiguration()` | Verify your setup is correct |
| `initialSync()` | First-time sync of all events |
| `syncCalendars()` | Manual sync (also runs automatically) |
| `setupTrigger()` | Enable 15-minute auto-sync |
| `setupHourlyTrigger()` | Enable hourly auto-sync (less frequent) |
| `removeTriggers()` | Disable automatic syncing |
| `checkTriggers()` | See current trigger status |
| `clearSyncedEvents()` | Remove all synced events (use carefully!) |

---

## Troubleshooting

### "Cannot access source calendar"

- Ensure the source calendar is shared with your destination account
- Double-check the calendar ID (it's case-sensitive)
- Accept any pending calendar share invitations

### Events not syncing

- Run `testConfiguration()` to diagnose issues
- Check the execution log for error messages
- Verify the sync window includes your events

### Duplicate events appearing

- The script uses hidden metadata to track synced events
- Run `clearSyncedEvents()` to reset, then `initialSync()` again

### Quota exceeded errors

- Google limits API calls (~5,000 calendar events created per day)
- Reduce `SYNC_DAYS_FUTURE` if syncing many events
- Switch to `setupHourlyTrigger()` for less frequent syncing

---

## How It Works

1. Script reads events from the source calendar
2. For each event, it checks if a synced copy exists in the destination
3. Creates new events or updates existing ones as needed
4. Removes events from destination if deleted from source
5. Synced events are marked with hidden metadata in the description

Events created directly in the destination calendar are ignored (no sync tag), so they won't affect the source calendar.

---

## Limitations

- Syncs basic event properties (title, time, description, location)
- Does not sync: reminders, attachments, conferencing links
- Maximum ~60-day future window recommended for performance
