// Whether this build may upload.
//
// A build-time switch rather than a setting, because the brief it comes from
// is explicit: automatic uploads stay off until the isolated PostgreSQL
// integration tests prove conflict handling, queued retries, account isolation
// and recovery from an interrupted run — and then they are enabled in the
// isolated testing environment, not everywhere.
//
// Off is the default and the safe direction. A build that cannot upload still
// downloads, still queues what the cook changes, and loses nothing: the queue
// is durable, so a build that is allowed to upload later sends what an earlier
// one could not.
//
//   RECIPEBOX_SYNC_UPLOADS=1 npx expo start
//
// The server has its own gate (RECIPEBOX_SYNC_WRITES) and does not trust this
// one. Two independent switches is deliberate: neither side can turn writes on
// by itself.

import Constants from "expo-constants";

export function uploadsEnabled(): boolean {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  return extra?.syncUploads === true;
}
