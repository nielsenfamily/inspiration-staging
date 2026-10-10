/* Toolkit: Inspiration — settings
   This is the ONLY file that differs between the live site and the staging site,
   and the only file that changes when the version number goes up. */
window.APP_CONFIG = {
  APP_NAME: 'Toolkit: Inspiration',
  TAGLINE: 'To God be the Glory',
  VERSION: '1.1.1',
  ENVIRONMENT: 'live',            // 'live' or 'staging' (staging shows a small badge)

  // From Supabase: Project Settings > API. Leave both blank to run in local-only test mode.
  SUPABASE_URL: 'https://kzbqprhccmnnlvizvsry.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6YnFwcmhjY21ubmx2aXp2c3J5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1OTA5MDksImV4cCI6MjEwNzE2NjkwOX0.y9x-SJsWoyNcua5gN5UVNZoE-xB7o2ARfDgFDu18ZaQ',

  // Days between backup reminders
  BACKUP_REMINDER_DAYS: 30,

  // Built-in background photos (files in the /backgrounds folder). Missing files are skipped.
  BACKGROUNDS: [
    { id: 'library-1', name: 'Reading room', file: 'backgrounds/library-1.jpg' },
    { id: 'library-2', name: 'Old shelves', file: 'backgrounds/library-2.jpg' },
    { id: 'nature-1', name: 'Forest path', file: 'backgrounds/nature-1.jpg' },
    { id: 'nature-2', name: 'Mountain lake', file: 'backgrounds/nature-2.jpg' },
    { id: 'nature-3', name: 'Morning field', file: 'backgrounds/nature-3.jpg' }
  ]
};
