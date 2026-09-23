/* ==========================================================================
   cloud.js: automatic sync, built on top of everything in sync.js.

   Same encryption, same merge rules, same payload shape as a manual link.
   The only difference is where the encrypted text travels: instead of you
   copying a link, every device (yours and your partner's) keeps one
   Firestore document holding its latest full, encrypted plan. Each device
   listens to every other device's document in real time and merges the
   moment one changes, exactly like opening a link sent to you.

   Documents live at datePlannerSpaces/{spaceId}/devices/{deviceId}, one per
   device rather than one per person, so your phone and your PC can each
   have their own without overwriting each other.

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
  let current = null; // { spaceId, deviceId }
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

  const devices = (spaceId) => db.collection("datePlannerSpaces").doc(spaceId).collection("devices");

  async function pushNow() {
    if (!db || !current || !DP.state.space) return;
    try {
      const cipher = await DP.sync.createCipher("full");
      await devices(current.spaceId).doc(current.deviceId).set({ payload: cipher, updatedAt: Date.now() });
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

  /** Begins syncing this space. Safe to call again for the same device; only a change of space restarts the listener. */
  function start(space, callbacks = {}) {
    if (callbacks.onMerge) onMerge = callbacks.onMerge;
    if (callbacks.onStatus) onStatus = callbacks.onStatus;
    if (!db && !init()) return;

    const deviceId = DP.state.deviceId();
    if (current && current.spaceId === space.id && current.deviceId === deviceId) return;

    stop();
    current = { spaceId: space.id, deviceId };
    setStatus("connecting");
    pushNow(); // make sure this device's own document exists and is current

    unsubscribe = devices(space.id).onSnapshot(
      (snapshot) => {
        setStatus("connected");
        snapshot.forEach((doc) => {
          if (doc.id === deviceId) return; // never merge our own document
          const data = doc.data();
          if (!data || !data.payload) return;
          DP.sync.open(data.payload, DP.state.space.password)
            .then((payload) => {
              if (payload.space !== DP.state.space.id) return;
              const result = DP.state.mergeIncoming(payload);
              if (onMerge) onMerge(result, payload);
            })
            .catch(() => {}); // wrong password, or a document from a different space; ignore
        });
      },
      () => setStatus("offline")
    );
  }

  DP.cloud = {
    configured, start, stop, pushNow, schedulePush,
    get status() { return status; }
  };
})(window.DP = window.DP || {});
