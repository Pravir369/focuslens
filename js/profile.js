export const PROFILE_KEY = "focuslens_profile_id";

export function validProfileId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

// Local ownership metadata only. This ID is neither authentication nor proof
// of identity, and must never be trusted as authorization by a future backend.
export class LocalProfile {
  constructor(getStorage = () => globalThis.localStorage, randomUUID = () => globalThis.crypto.randomUUID()) {
    Object.assign(this, { getStorage, randomUUID });
    this.id = null;
    this.persistent = false;
    this.message = "";
  }

  getId() {
    if (this.id) return this.id;
    try {
      const storage = this.getStorage();
      const existing = storage.getItem(PROFILE_KEY);
      this.id = validProfileId(existing) ? existing : this.randomUUID();
      if (!validProfileId(this.id)) throw new Error("Invalid local profile ID");
      if (this.id !== existing) storage.setItem(PROFILE_KEY, this.id);
      this.persistent = true;
    } catch {
      this.id ||= this.randomUUID();
      this.message = "Local profile storage is unavailable. Sessions still work, but this profile lasts only until reload.";
    }
    return this.id;
  }
}

const current = new LocalProfile();
export const getCurrentProfileId = () => current.getId();
