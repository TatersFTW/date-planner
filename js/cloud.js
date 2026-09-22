/* ==========================================================================
   cloud.js: automatic sync, built on top of everything in sync.js.

   Same encryption, same merge rules, same payload shape as a manual link.
   The only difference is where the encrypted text travels: instead of you
   copying a link, each of you keeps one Firestore document holding your
   latest full, encrypted plan. Your device listens to your partner's
   document in real time and merges it the moment it changes, exactly like
   opening a link they sent you.

   If js/firebase-config.js has no config, or the Firebase scripts didn't
   load, or the device is offline, none of this runs and the app falls back
   to the manual links and backups on the Sync page. Nothing here is
   required for the app to work.

   To swap Firestore for a different backend later, only start(), stop() and
   pushNow() below need to change; everything else in the app calls this
   same small interface.
   ========================================================================== */
(function (DP) {
  "use strict";

  const PUSH_DELAY_MS = 700;

  let db = null;
  let unsubscribe = null;
  let pushTimer = null;
  let current = null; // { spaceId, me }
  let onMerge = null;
  let onStatus = null;
  let status = "unconfigured"; // unconfigured | connecting | connected | offline | error

  function setStatus(next) {
    if (status === next) return;
    status = next;
    if (onStatus) onStatus(status);
  }

  const configured = () => !!window.DP_FIREBASE_CONFIG;

  function init() {
    if (!configured()) { setStatus("unconfigured"); return false; }
    if (!window.firebase || !window.firebase.initializeApp || !window.firebase.firestore) {
      setStatus("error");
      return false;
    }
    try {
      if (!window.firebase.apps.length) window.firebase.initializeApp(window.DP_FIREBASE_CONFIG);
      db = window.firebase.firestore();
      return true;
    } catch {
      setStatus("error");
      return false;
    }
  }

  /** One document per person: datePlannerSpaces/{spaceId}/members/{a-or-b} */
  const memberDoc = (spaceId, member) => db.collection("datePlannerSpaces").doc(spaceId).collection("members").doc(member);

  async function pushNow() {
    if (!db || !current || !DP.state.space) return;
    try {
      const cipher = await DP.sync.createCipher("full");
      await memberDoc(current.spaceId, current.me).set({ payload: cipher, updatedAt: Date.now() });
      DP.state.markSent();
      setStatus("connected");
    } catch {
      setStatus("error");
    }
  }

  /** Call after any local change. Waits briefly so a burst of taps sends once. */
  function schedulePush() {
    if (!db || !current) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, PUSH_DELAY_MS);
  }

  function stop() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    clearTimeout(pushTimer);
    current = null;
    setStatus(configured() ? "connecting" : "unconfigured");
  }

  /** Begins syncing this space. Safe to call again for the same space; only a change of space or person restarts the listener. */
  function start(space, callbacks = {}) {
    if (callbacks.onMerge) onMerge = callbacks.onMerge;
    if (callbacks.onStatus) onStatus = callbacks.onStatus;
    if (!db && !init()) return;
    if (current && current.spaceId === space.id && current.me === space.me) return;

    stop();
    current = { spaceId: space.id, me: space.me };
    setStatus("connecting");
    pushNow(); // make sure our own document exists and is current

    const partner = DP.model.other(space.me);
    unsubscribe = memberDoc(space.id, partner).onSnapshot(
      async (snap) => {
        setStatus("connected");
        const data = snap.data();
        if (!data || !data.payload) return; // partner hasn't synced yet
        let payload;
        try {
          payload = await DP.sync.open(data.payload, DP.state.space.password);
        } catch {
          return; // wrong password or a document from a different space; ignore
        }
        if (payload.space !== DP.state.space.id || payload.from !== partner) return;
        const result = DP.state.mergeIncoming(payload);
        if (onMerge) onMerge(result, payload);
      },
      () => setStatus("offline")
    );
  }

  DP.cloud = {
    configured, start, stop, pushNow, schedulePush,
    get status() { return status; }
  };
})(window.DP = window.DP || {});
