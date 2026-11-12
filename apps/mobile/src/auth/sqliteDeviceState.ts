// The device-state store that actually persists: a small SQLite file in the
// app sandbox, which is removed when the app is deleted. That is the whole
// point of it — see deviceState.ts for why the iOS Keychain is not.
//
// Kept in its own file, like secureCredentialStore.ts, so that nothing the
// offline tests import reaches a native module.
import * as SQLite from "expo-sqlite";
import { randomInstallId, type DeviceState } from "./deviceState.ts";

const DB_NAME = "recipebox-device.db";

export function sqliteDeviceState(): DeviceState {
  let handle: Promise<SQLite.SQLiteDatabase> | null = null;
  function db() {
    if (!handle) {
      handle = SQLite.openDatabaseAsync(DB_NAME).then(async (open) => {
        await open.execAsync(
          "CREATE TABLE IF NOT EXISTS device_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        );
        return open;
      });
    }
    return handle;
  }

  async function read(key: string): Promise<string | null> {
    try {
      const open = await db();
      const row = await open.getFirstAsync<{ value: string }>("SELECT value FROM device_state WHERE key = ?", key);
      return row ? row.value : null;
    } catch {
      return null;
    }
  }

  async function write(key: string, value: string | null): Promise<void> {
    try {
      const open = await db();
      if (value === null) await open.runAsync("DELETE FROM device_state WHERE key = ?", key);
      else await open.runAsync("INSERT INTO device_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
    } catch {
      // Losing one of these costs a sign-in or an extra local store, never data.
    }
  }

  return {
    async isFreshInstall() {
      const marker = await read("installed_at");
      if (marker) return false;
      // If the write fails we will ask again next launch and say "fresh" again,
      // which signs the person in once more. Annoying; never destructive.
      await write("installed_at", new Date().toISOString());
      return true;
    },
    getClaim: () => read("library_claimed_by"),
    setClaim: (userId: string) => write("library_claimed_by", userId),
    getLastUser: () => read("last_user"),
    setLastUser: (userId: string | null) => write("last_user", userId),
    async getInstallId() {
      const existing = await read("install_id");
      if (existing) return existing;
      const minted = randomInstallId();
      await write("install_id", minted);
      return minted;
    },
  };
}

