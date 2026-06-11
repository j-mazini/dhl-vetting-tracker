const settings = window.BA_FIREBASE;
const config = settings && settings.config;
const configured = config
    && config.apiKey
    && !String(config.apiKey).startsWith("PASTE_")
    && config.projectId
    && !String(config.projectId).startsWith("PASTE_");

if (!configured) {
    window.setSyncStatus("", "Local only", "Configure firebase-config.js to enable cloud sync");
    window.setFirebaseAuthButton("Connect", false);
    window.setAuthGate("error", "Firebase is not configured. Complete firebase-config.js and reload the page.");
} else {
    startFirebase().catch(error => {
        console.error("Firebase startup failed:", error);
        window.setSyncStatus("error", "Cloud error", readableError(error));
        window.setFirebaseAuthButton("Retry", false);
        window.setAuthGate("error", readableError(error), "Try again");
    });
}

async function startFirebase() {
    window.setAuthGate("loading", "Connecting securely to Firebase...");
    window.setSyncStatus("syncing", "Connecting", "Loading Firebase");
    window.setFirebaseAuthButton("Connecting", true);

    const version = "12.14.0";
    const [{ initializeApp }, authSdk, firestoreSdk] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
    ]);

    const app = initializeApp(config);
    const auth = authSdk.getAuth(app);
    const db = firestoreSdk.getFirestore(app);
    const provider = new authSdk.GoogleAuthProvider();
    const workspaceId = safeId(settings.workspaceId || "ba-express-vetting");
    const vendorsRef = firestoreSdk.collection(db, "workspaces", workspaceId, "vendors");

    let user = null;
    let unsubscribe = null;
    let subscriber = () => {};
    let saveTimer = null;
    let pendingVendors = null;
    let firstSnapshot = true;
    const remoteFingerprints = new Map();

    const adapter = {
        subscribe(callback) {
            subscriber = callback;
        },

        saveAll(nextVendors) {
            if (!user) return;
            pendingVendors = JSON.parse(JSON.stringify(nextVendors));
            clearTimeout(saveTimer);
            saveTimer = setTimeout(flush, 650);
            window.setSyncStatus("syncing", "Saving", "Changes are being saved to Firestore");
        },

        async deleteOne(id) {
            if (!user) return;
            try {
                await firestoreSdk.deleteDoc(firestoreSdk.doc(vendorsRef, safeId(id)));
            } catch (error) {
                showError(error);
            }
        },

        async authAction() {
            try {
                window.setFirebaseAuthButton(user ? "Signing out" : "Opening Google", true);
                if (user) {
                    window.setAuthGate("loading", "Signing out...");
                    clearTimeout(saveTimer);
                    await flush();
                    await authSdk.signOut(auth);
                } else {
                    window.setAuthGate("signing-in", "Choose an authorized Google account.");
                    await authSdk.signInWithPopup(auth, provider);
                }
            } catch (error) {
                showError(error);
                window.setFirebaseAuthButton(user ? "Sign out" : "Connect", false);
            }
        }
    };

    async function flush() {
        if (!user || !pendingVendors) return;
        const snapshot = pendingVendors;
        pendingVendors = null;

        try {
            const changed = snapshot.filter(vendor =>
                remoteFingerprints.get(vendor.id) !== fingerprint(vendor)
            );

            for (let offset = 0; offset < changed.length; offset += 400) {
                const batch = firestoreSdk.writeBatch(db);
                const chunk = changed.slice(offset, offset + 400);
                chunk.forEach(vendor => {
                    batch.set(
                        firestoreSdk.doc(vendorsRef, safeId(vendor.id)),
                        { ...vendor, _updatedAt: firestoreSdk.serverTimestamp() }
                    );
                });
                await batch.commit();
                chunk.forEach(vendor => remoteFingerprints.set(vendor.id, fingerprint(vendor)));
            }
            window.setSyncStatus("online", "Synced", `Connected as ${user.email || user.displayName}`);
        } catch (error) {
            pendingVendors = snapshot;
            showError(error);
        }
    }

    function listenForVendors() {
        if (unsubscribe) unsubscribe();
        firstSnapshot = true;
        unsubscribe = firestoreSdk.onSnapshot(
            firestoreSdk.query(vendorsRef),
            snapshot => {
                const remote = snapshot.docs.map(item => {
                    const data = item.data();
                    delete data._updatedAt;
                    remoteFingerprints.set(data.id, fingerprint(data));
                    return data;
                });
                const remoteIds = new Set(remote.map(vendor => vendor.id));
                [...remoteFingerprints.keys()].forEach(id => {
                    if (!remoteIds.has(id)) remoteFingerprints.delete(id);
                });

                if (firstSnapshot && remote.length === 0) {
                    firstSnapshot = false;
                    const local = window.localVendorSnapshot();
                    if (local.length) {
                        adapter.saveAll(local);
                        return;
                    }
                }

                firstSnapshot = false;
                subscriber(remote);
                window.setSyncStatus("online", "Synced", `Connected as ${user.email || user.displayName}`);
                window.setAuthGate("authenticated");
            },
            showError
        );
    }

    authSdk.onAuthStateChanged(auth, nextUser => {
        user = nextUser;
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }

        if (user) {
            window.setFirebaseAuthButton("Sign out", false);
            window.setSyncStatus("syncing", "Loading", `Connected as ${user.email || user.displayName}`);
            window.setAuthGate("loading", `Checking access for ${user.email || user.displayName}...`);
            listenForVendors();
        } else {
            window.setFirebaseAuthButton("Connect", false);
            window.setSyncStatus("", "Local only", "Sign in to synchronize this browser with Firestore");
            window.setAuthGate("signed-out");
        }
    });

    window.configureCloudSync(adapter);
}

function safeId(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function fingerprint(value) {
    return JSON.stringify(value);
}

function showError(error) {
    console.error("Firebase sync failed:", error);
    const message = readableError(error);
    window.setSyncStatus("error", "Sync error", message);
    window.setAuthGate(
        "error",
        message,
        error && error.code === "permission-denied" ? "Sign out and use another account" : "Try again"
    );
}

function readableError(error) {
    const code = error && error.code ? String(error.code).replace("auth/", "") : "";
    if (code === "popup-closed-by-user") return "Google sign-in was cancelled.";
    if (code === "unauthorized-domain") return "Add this website domain in Firebase Authentication > Settings > Authorized domains.";
    if (code === "permission-denied") return "This account is not allowed by the Firestore security rules.";
    return error && error.message ? error.message : "Could not connect to Firebase.";
}
