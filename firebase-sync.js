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
    const [{ initializeApp }, authSdk, firestoreSdk, storageSdk] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-storage.js`)
    ]);

    const app = initializeApp(config);
    const auth = authSdk.getAuth(app);
    const db = firestoreSdk.getFirestore(app);
    const storage = storageSdk.getStorage(app);
    const provider = new authSdk.GoogleAuthProvider();
    provider.setCustomParameters({ hd: "baexpress.co.uk", prompt: "select_account" });
    const workspaceId = safeId(settings.workspaceId || "ba-express-vetting");
    const vendorsRef = firestoreSdk.collection(db, "workspaces", workspaceId, "vendors");

    let user = null;
    let unsubscribe = null;
    let subscriber = () => {};
    let saveTimer = null;
    let pendingVendors = null;
    let firstSnapshot = true;
    let rejectedAccountMessage = "";
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

        async deleteOne(id, documentPaths = []) {
            if (!user) return;
            try {
                await Promise.all(documentPaths.filter(Boolean).map(path =>
                    storageSdk.deleteObject(storageSdk.ref(storage, path))
                        .catch(error => {
                            if (error && error.code !== "storage/object-not-found") throw error;
                        })
                ));
                await firestoreSdk.deleteDoc(firestoreSdk.doc(vendorsRef, safeId(id)));
            } catch (error) {
                showError(error);
            }
        },

        async uploadDocument({
            vendorId,
            documentKey,
            documentLabel,
            file,
            fileName,
            contentType,
            previousPath,
            onProgress
        }) {
            if (!user) throw new Error("Sign in before uploading documents.");
            const path = `workspaces/${workspaceId}/drivers/${safeId(vendorId)}/${fileName}`;
            const fileRef = storageSdk.ref(storage, path);
            const task = storageSdk.uploadBytesResumable(fileRef, file, {
                contentType,
                customMetadata: {
                    uploaderUid: user.uid,
                    uploaderEmail: String(user.email || "").toLowerCase(),
                    documentKey,
                    documentLabel,
                    vendorId
                }
            });

            await new Promise((resolve, reject) => {
                task.on(
                    "state_changed",
                    snapshot => {
                        const percent = snapshot.totalBytes
                            ? Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100)
                            : 0;
                        if (onProgress) onProgress(percent);
                    },
                    reject,
                    resolve
                );
            });

            if (previousPath && previousPath !== path) {
                await storageSdk.deleteObject(storageSdk.ref(storage, previousPath))
                    .catch(error => {
                        if (error && error.code !== "storage/object-not-found") throw error;
                    });
            }

            return {
                path,
                fileName,
                contentType,
                size: file.size
            };
        },

        async viewDocument(path, fileName) {
            if (!user) throw new Error("Sign in before viewing documents.");
            const blob = await adapter.getDocumentBlob(path);
            const url = URL.createObjectURL(blob);
            const opened = window.open(url, "_blank", "noopener");
            if (!opened) {
                const link = document.createElement("a");
                link.href = url;
                link.target = "_blank";
                link.rel = "noopener";
                link.download = fileName || "document";
                link.click();
            }
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        },

        async getDocumentBlob(path) {
            if (!user) throw new Error("Sign in before accessing documents.");
            return storageSdk.getBlob(storageSdk.ref(storage, path));
        },

        async deleteDocument(path) {
            if (!user) throw new Error("Sign in before deleting documents.");
            await storageSdk.deleteObject(storageSdk.ref(storage, path));
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
                    rejectedAccountMessage = "";
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
            const changed = snapshot
                .map(ensureAuditIdentity)
                .filter(vendor => remoteFingerprints.get(vendor.id) !== fingerprint(vendor));

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
                const local = window.localVendorSnapshot();
                const isOwnPendingWrite = snapshot.metadata.hasPendingWrites;
                const matchesLocalState = sameVendorData(remote, local);
                if (!isOwnPendingWrite && !matchesLocalState) subscriber(remote);
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

        if (user && !isBaExpressEmail(user.email)) {
            rejectedAccountMessage = `Access denied for ${user.email}. Use a Google account ending in @baexpress.co.uk.`;
            window.setAuthenticatedUser(null);
            window.setFirebaseAuthButton("Use another account", false);
            window.setSyncStatus("error", "Access denied", rejectedAccountMessage);
            window.setAuthGate("error", rejectedAccountMessage, "Use another account");
            authSdk.signOut(auth);
            return;
        }

        if (user) {
            window.setAuthenticatedUser(user);
            window.setFirebaseAuthButton("Sign out", false);
            window.setSyncStatus("syncing", "Loading", `Connected as ${user.email || user.displayName}`);
            window.setAuthGate("loading", `Checking access for ${user.email || user.displayName}...`);
            listenForVendors();
        } else {
            window.setAuthenticatedUser(null);
            window.setFirebaseAuthButton("Connect", false);
            window.setSyncStatus("", "Local only", "Sign in to synchronize this browser with Firestore");
            if (rejectedAccountMessage) {
                window.setAuthGate("error", rejectedAccountMessage, "Use another account");
            } else {
                window.setAuthGate("signed-out");
            }
        }
    });

    window.configureCloudSync(adapter);

    function ensureAuditIdentity(vendor) {
        const actor = {
            uid: user.uid,
            email: String(user.email || "").toLowerCase(),
            name: user.displayName || user.email || ""
        };
        const copy = JSON.parse(JSON.stringify(vendor));
        const now = Date.now();
        if (!copy.createdBy) copy.createdBy = { ...actor };
        if (!copy.updatedBy) copy.updatedBy = { ...actor };
        if (!copy.updatedAt) copy.updatedAt = now;
        if (!Array.isArray(copy.auditLog)) copy.auditLog = [];
        if (!copy.auditLog.length) {
            copy.auditLog.push({
                id: "a" + now + "import",
                at: now,
                action: "created",
                actor: { ...actor },
                changes: [{ field: "Driver", before: "—", after: copy.name || "Imported case" }]
            });
        }
        return copy;
    }
}

function isBaExpressEmail(email) {
    return /^[^@\s]+@baexpress\.co\.uk$/i.test(String(email || ""));
}

function safeId(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function fingerprint(value) {
    return JSON.stringify(value);
}

function sameVendorData(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const byId = new Map(right.map(vendor => [vendor.id, fingerprint(vendor)]));
    return left.every(vendor => byId.get(vendor.id) === fingerprint(vendor));
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
    if (code === "storage/unauthorized") return "This account is not allowed by the Firebase Storage security rules.";
    if (code === "storage/object-not-found") return "This document no longer exists in Firebase Storage.";
    return error && error.message ? error.message : "Could not connect to Firebase.";
}
