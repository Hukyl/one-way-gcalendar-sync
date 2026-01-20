/**
 * One-Way Google Calendar Sync Script
 * 
 * Syncs events from a SOURCE calendar to a DESTINATION calendar (your primary calendar).
 * Changes only flow one direction: Source → Destination
 * Events created in the destination calendar are NOT synced back.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open Google Apps Script (script.google.com) in the DESTINATION account
 * 2. Create a new project and paste this code
 * 3. Share your SOURCE calendar with the destination account (at least "See all event details")
 * 4. Get the SOURCE calendar ID (Settings → Integrate calendar → Calendar ID)
 * 5. Set Script Properties (Project Settings → Script Properties → Add SOURCE_CALENDAR_ID)
 * 6. Run setupTrigger() once to enable automatic syncing
 * 7. Run initialSync() for the first sync
 */


function getConfig() {
  const props = PropertiesService.getScriptProperties();
  
  return {
    // The calendar ID of your SOURCE calendar (the one you want to copy FROM)
    //   Find this in: Google Calendar → Settings → [Your Calendar] → Integrate calendar → Calendar ID
    //   For a personal calendar, it's usually your email address
    //   For a shared calendar, it looks like: abc123@group.calendar.google.com
    SOURCE_CALENDAR_ID: props.getProperty('SOURCE_CALENDAR_ID') || 'YOUR_SOURCE_CALENDAR_ID_HERE',

    // The calendar ID of your DESTINATION calendar
    //   Usually 'primary' for your main calendar    
    DESTINATION_CALENDAR_ID: props.getProperty('DESTINATION_CALENDAR_ID') || 'primary',

    // How many days in the past to sync
    SYNC_DAYS_PAST: parseInt(props.getProperty('SYNC_DAYS_PAST')) || 7,

    // How many days in the future to sync
    SYNC_DAYS_FUTURE: parseInt(props.getProperty('SYNC_DAYS_FUTURE')) || 60,

    // Prefix to identify synced events (helps avoid syncing events back)
    // This is added to the event description internally, not visible in title
    SYNC_TAG: '[SYNCED_FROM_SOURCE]',

    // Whether to sync event details (description, location, etc.)
    SYNC_DETAILS: props.getProperty('SYNC_DETAILS') !== 'false',

    // Whether to copy attendees (usually false to avoid sending invites)
    COPY_ATTENDEES: props.getProperty('COPY_ATTENDEES') === 'true',

    // Whether to delete events from destination when deleted from source
    DELETE_REMOVED_EVENTS: props.getProperty('DELETE_REMOVED_EVENTS') !== 'false',
  };
}

const CONFIG = getConfig();

// ============================================================================
// SYNC METADATA HANDLER
// ============================================================================

/**
 * Handles sync metadata embedded in event descriptions.
 * Format: <!-- [SYNCED_FROM_SOURCE] SOURCE_ID:<event_id>_<start_time_iso> -->
 *
 * For recurring events, the base event ID is the same for all instances,
 * so we append the start time to create a unique identifier per instance.
 */
class SyncMetadata {
  /**
   * Create a unique instance ID for an event
   * Combines base event ID with start time to handle recurring events
   * @param {CalendarEvent} event - The calendar event
   * @returns {string} Unique identifier for this specific instance
   */
  static createInstanceId(event) {
    const baseId = event.getId();
    const startTime = event.getStartTime().toISOString();
    return `${baseId}_${startTime}`;
  }

  /**
   * Create a metadata tag for embedding in event description
   * @param {string} instanceId - The unique instance ID (from createInstanceId)
   * @returns {string} The metadata string to append to description
   */
  static createTag(instanceId) {
    return `\n\n<!-- ${CONFIG.SYNC_TAG} SOURCE_ID:${instanceId} -->`;
  }

  /**
   * Check if a description contains sync metadata
   * @param {string} description - The event description
   * @returns {boolean} True if sync metadata is present
   */
  static hasTag(description) {
    if (!description) return false;
    return this._getPattern().test(description);
  }

  /**
   * Extract the source event ID from a description
   * @param {string} description - The event description
   * @returns {string|null} The source ID or null if not found
   */
  static extractSourceId(description) {
    if (!description) return null;
    const match = description.match(this._getPattern());
    return match ? match[1] : null;
  }

  /**
   * Strip sync metadata from description (for comparison purposes)
   * @param {string} description - The event description
   * @returns {string} Description without sync metadata
   */
  static stripTag(description) {
    if (!description) return '';
    return description.replace(this._getPattern(), '').trim();
  }

  /**
   * Get the regex pattern for matching sync metadata
   * Matches: <!-- [SYNCED_FROM_SOURCE] SOURCE_ID:<id> -->
   * @returns {RegExp} The compiled regex pattern
   */
  static _getPattern() {
    // Escape special regex chars in SYNC_TAG (brackets)
    const escapedTag = CONFIG.SYNC_TAG.replace(/[[\]]/g, '\\$&');
    // Match the full HTML comment structure, capture the source ID (non-whitespace chars)
    return new RegExp(`<!--\\s*${escapedTag}\\s+SOURCE_ID:(\\S+)\\s*-->`);
  }
}

// ============================================================================
// MAIN SYNC FUNCTION
// ============================================================================

/**
 * Main sync function - call this manually or via trigger
 */
function syncCalendars() {
  console.log('Starting calendar sync...');
  
  const sourceCalendar = CalendarApp.getCalendarById(CONFIG.SOURCE_CALENDAR_ID);
  const destCalendar = CalendarApp.getCalendarById(CONFIG.DESTINATION_CALENDAR_ID);
  
  if (!sourceCalendar) {
    console.error('ERROR: Could not access source calendar. Check the calendar ID and sharing settings.');
    return;
  }
  
  if (!destCalendar) {
    console.error('ERROR: Could not access destination calendar.');
    return;
  }
  
  console.log(`Source calendar: ${sourceCalendar.getName()}`);
  console.log(`Destination calendar: ${destCalendar.getName()}`);
  
  // Calculate sync window
  const now = new Date();
  const startDate = new Date(now.getTime() - (CONFIG.SYNC_DAYS_PAST * 24 * 60 * 60 * 1000));
  const endDate = new Date(now.getTime() + (CONFIG.SYNC_DAYS_FUTURE * 24 * 60 * 60 * 1000));
  
  console.log(`Sync window: ${startDate.toDateString()} to ${endDate.toDateString()}`);
  
  // Get events from source
  const sourceEvents = sourceCalendar.getEvents(startDate, endDate);
  console.log(`Found ${sourceEvents.length} events in source calendar`);
  
  // Get existing synced events from destination
  const destEvents = destCalendar.getEvents(startDate, endDate);
  const syncedEventsMap = buildSyncedEventsMap(destEvents);
  
  // Track which source events we've processed (for deletion detection)
  const processedSourceIds = new Set();
  
  // Sync each source event
  let created = 0, updated = 0, unchanged = 0;

  for (const sourceEvent of sourceEvents) {
    // Use instance ID (base ID + start time) to handle recurring events
    const instanceId = SyncMetadata.createInstanceId(sourceEvent);
    processedSourceIds.add(instanceId);

    const result = syncEvent(sourceEvent, destCalendar, syncedEventsMap);
    
    if (result === 'created') created++;
    else if (result === 'updated') updated++;
    else unchanged++;
  }
  
  // Handle deletions
  let deleted = 0;
  if (CONFIG.DELETE_REMOVED_EVENTS) {
    deleted = deleteRemovedEvents(syncedEventsMap, processedSourceIds);
  }
  
  console.log(`Sync complete! Created: ${created}, Updated: ${updated}, Unchanged: ${unchanged}, Deleted: ${deleted}`);
}

/**
 * Initial sync - use this for the first run to sync all events
 */
function initialSync() {
  console.log('Running initial sync...');
  syncCalendars();
  console.log('Initial sync complete!');
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build a map of synced events in the destination calendar
 * Key: source event ID, Value: destination event
 */
function buildSyncedEventsMap(destEvents) {
  const map = new Map();
  
  for (const event of destEvents) {
    const description = event.getDescription() || '';
    const sourceId = SyncMetadata.extractSourceId(description);
    
    if (sourceId) {
      map.set(sourceId, event);
    }
  }
  
  return map;
}

/**
 * Sync a single event from source to destination
 * Returns: 'created', 'updated', or 'unchanged'
 */
function syncEvent(sourceEvent, destCalendar, syncedEventsMap) {
  // Use instance ID to handle recurring events (each instance has same base ID)
  const instanceId = SyncMetadata.createInstanceId(sourceEvent);
  const existingDestEvent = syncedEventsMap.get(instanceId);

  // Prepare event data
  const eventData = {
    title: sourceEvent.getTitle(),
    startTime: sourceEvent.getStartTime(),
    endTime: sourceEvent.getEndTime(),
    description: buildSyncedDescription(sourceEvent, instanceId),
    location: CONFIG.SYNC_DETAILS ? sourceEvent.getLocation() : '',
    isAllDay: sourceEvent.isAllDayEvent(),
  };

  if (existingDestEvent) {
    const existingData = {
      title: existingDestEvent.getTitle(),
      startTime: existingDestEvent.getStartTime(),
      endTime: existingDestEvent.getEndTime(),
      description: existingDestEvent.getDescription(),
      location: existingDestEvent.getLocation() ?? '',
      isAllDay: existingDestEvent.isAllDayEvent(),
    };
  
    // Check if update is needed
    const toUpdate = needsUpdate(existingData, eventData);
  
    if (toUpdate) {
      updateEvent(existingDestEvent, eventData);
      return 'updated';
    }
    return 'unchanged';
  } else {
    // Create new event
    createEvent(destCalendar, eventData);
    return 'created';
  }
}

/**
 * Build the description with sync metadata
 */
function buildSyncedDescription(sourceEvent, instanceId) {
  let description = '';

  if (CONFIG.SYNC_DETAILS) {
    description = sourceEvent.getDescription() || '';
  }

  return description + SyncMetadata.createTag(instanceId);
}

/**
 * Check if an existing event needs to be updated
 */
function needsUpdate(existingData, newData) {
  if (existingData.title !== newData.title) return true;
  if (existingData.startTime.getTime() !== newData.startTime.getTime()) return true;
  if (existingData.endTime.getTime() !== newData.endTime.getTime()) return true;
  if (existingData.location !== newData.location) return true;
  
  // Check description (excluding metadata)
  const existingDesc = SyncMetadata.stripTag(existingData.description);
  const newDesc = SyncMetadata.stripTag(newData.description);
  if (existingDesc !== newDesc) return true;
  
  return false;
}

/**
 * Create a new event in the destination calendar
 */
function createEvent(calendar, eventData) {
  let event;
  
  if (eventData.isAllDay) {
    // For all-day events
    const startDate = new Date(eventData.startTime);
    const endDate = new Date(eventData.endTime);
    
    // Check if it's a single day or multi-day event
    const daysDiff = Math.round((endDate - startDate) / (24 * 60 * 60 * 1000));
    
    if (daysDiff <= 1) {
      event = calendar.createAllDayEvent(eventData.title, startDate);
    } else {
      event = calendar.createAllDayEvent(eventData.title, startDate, endDate);
    }
  } else {
    event = calendar.createEvent(eventData.title, eventData.startTime, eventData.endTime);
  }
  
  // Set additional properties
  if (eventData.description) {
    event.setDescription(eventData.description);
  }
  if (eventData.location) {
    event.setLocation(eventData.location);
  }
  
  console.log(`Created: ${eventData.title} on ${eventData.startTime.toDateString()}`);
  return event;
}

/**
 * Update an existing event in the destination calendar
 */
function updateEvent(event, eventData) {
  event.setTitle(eventData.title);
  
  if (eventData.isAllDay) {
    // All-day events need special handling
    event.setAllDayDate(eventData.startTime);
  } else {
    event.setTime(eventData.startTime, eventData.endTime);
  }
  
  event.setDescription(eventData.description);
  event.setLocation(eventData.location);
  
  console.log(`Updated: ${eventData.title}`);
}

/**
 * Delete events that no longer exist in the source
 */
function deleteRemovedEvents(syncedEventsMap, processedSourceIds) {
  let deleted = 0;
  
  for (const [sourceId, destEvent] of syncedEventsMap) {
    if (!processedSourceIds.has(sourceId)) {
      console.log(`Deleting removed event: ${destEvent.getTitle()}`);
      destEvent.deleteEvent();
      deleted++;
    }
  }
  
  return deleted;
}

// ============================================================================
// TRIGGER MANAGEMENT
// ============================================================================

/**
 * Set up automatic sync trigger
 * Run this once to enable scheduled syncing
 */
function setupTrigger() {
  // Remove any existing triggers for this function
  removeTriggers();
  
  // Create a new trigger to run every 15 minutes
  ScriptApp.newTrigger('syncCalendars')
    .timeBased()
    .everyMinutes(15)
    .create();
  
  console.log('Trigger created! Calendar will sync every 15 minutes.');
}

/**
 * Set up hourly sync (if you prefer less frequent syncing)
 */
function setupHourlyTrigger() {
  removeTriggers();
  
  ScriptApp.newTrigger('syncCalendars')
    .timeBased()
    .everyHours(1)
    .create();
  
  console.log('Trigger created! Calendar will sync every hour.');
}

/**
 * Remove all triggers for this script
 */
function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'syncCalendars') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  console.log('Existing triggers removed.');
}

/**
 * Check current trigger status
 */
function checkTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  
  if (triggers.length === 0) {
    console.log('No triggers are set up. Run setupTrigger() to enable automatic syncing.');
    return;
  }
  
  for (const trigger of triggers) {
    console.log(`Trigger: ${trigger.getHandlerFunction()}, Type: ${trigger.getEventType()}`);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Test configuration - run this to verify your setup
 */
function testConfiguration() {
  console.log('Testing configuration...\n');
  
  // Test source calendar access
  console.log('Testing source calendar access...');
  const sourceCalendar = CalendarApp.getCalendarById(CONFIG.SOURCE_CALENDAR_ID);
  
  if (sourceCalendar) {
    console.log(`✓ Source calendar found: ${sourceCalendar.getName()}`);
  } else {
    console.log('✗ ERROR: Cannot access source calendar!');
    console.log('  - Check that the calendar ID is correct');
    console.log('  - Make sure the source calendar is shared with this account');
    return;
  }
  
  // Test destination calendar access
  console.log('\nTesting destination calendar access...');
  const destCalendar = CalendarApp.getCalendarById(CONFIG.DESTINATION_CALENDAR_ID);
  
  if (destCalendar) {
    console.log(`✓ Destination calendar found: ${destCalendar.getName()}`);
  } else {
    console.log('✗ ERROR: Cannot access destination calendar!');
    return;
  }
  
  // Test fetching events
  console.log('\nTesting event fetch...');
  const now = new Date();
  const endDate = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
  const events = sourceCalendar.getEvents(now, endDate);
  console.log(`✓ Found ${events.length} events in the next 7 days`);
  
  console.log('\n✓ Configuration test passed! You can now run initialSync()');
}

/**
 * Clear all synced events from destination (use with caution!)
 * This removes all events that were created by this sync script
 */
function clearSyncedEvents() {
  const destCalendar = CalendarApp.getCalendarById(CONFIG.DESTINATION_CALENDAR_ID);
  const now = new Date();
  const startDate = new Date(now.getTime() - (CONFIG.SYNC_DAYS_PAST * 24 * 60 * 60 * 1000));
  const endDate = new Date(now.getTime() + (CONFIG.SYNC_DAYS_FUTURE * 24 * 60 * 60 * 1000));
  
  const events = destCalendar.getEvents(startDate, endDate);
  let deleted = 0;
  
  for (const event of events) {
    if (SyncMetadata.hasTag(event.getDescription())) {
      event.deleteEvent();
      deleted++;
    }
  }
  
  console.log(`Cleared ${deleted} synced events from destination calendar.`);
}