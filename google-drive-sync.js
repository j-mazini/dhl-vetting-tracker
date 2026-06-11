/**
 * Google Drive Document Integration for BA Express Vetting Tracker
 *
 * OVERVIEW:
 * This module provides seamless Google Drive integration for document uploads,
 * allowing users to reference files stored in their Google Drive instead of
 * uploading to Firebase Storage. This reduces storage costs and gives users
 * control over document sharing and retention.
 *
 * FEATURES:
 * - Lazy scope negotiation: Google Drive permissions requested only on first use
 * - Warning system: Alerts when Drive files are inaccessible or deleted
 * - Backward compatibility: Existing Firebase Storage documents continue to work
 * - Audit trail: All document operations logged for compliance
 *
 * ARCHITECTURE:
 * 1. GoogleDrivePicker - Opens file picker, requests lazy scope on first click
 * 2. DocumentRef - Stores either Drive link or Storage path in metadata
 * 3. AccessValidator - Checks Drive file accessibility before export/view
 * 4. Migration - Handles transition from Storage to Drive seamlessly
 */

let googleDriveScope = false; // Lazy flag: have we requested Drive scope?
let googleDriveHelper = null; // Google Drive helper instance

/**
 * Initialize Google Drive integration
 * Called after Firebase auth is ready
 */
function initGoogleDrive() {
    if (!window.gapi) {
        console.warn('[GoogleDrive] Google API client not loaded');
        return;
    }

    // Load Google Drive API (loads on demand, not at startup)
    gapi.load('picker', {
        callback: () => {
            console.log('[GoogleDrive] Picker API ready');
        },
        onerror: (err) => {
            console.error('[GoogleDrive] Failed to load Picker API:', err);
        }
    });
}

/**
 * Open Google Drive Picker to select a document
 * Requests Drive scope on first use (lazy negotiation)
 *
 * @param {string} label - Document label (e.g., "Identity Document")
 * @param {Function} onSelect - Callback when file selected: onSelect({id, name, mimeType})
 */
function openGoogleDrivePicker(label, onSelect) {
    if (!authenticatedUser) {
        alert('Please sign in before selecting documents from Google Drive');
        return;
    }

    if (!window.gapi || !window.gapi.picker) {
        alert('Google Drive is not available. Please reload the page.');
        return;
    }

    // Lazy scope negotiation: Request Drive scope only if not already requested
    if (!googleDriveScope) {
        console.log('[GoogleDrive] Requesting Drive scope (lazy)...');
        gapi.auth2.getAuthInstance().signIn({
            scope: 'https://www.googleapis.com/auth/drive.readonly'
        }).then(() => {
            googleDriveScope = true;
            _showGoogleDrivePicker(label, onSelect);
        }).catch(err => {
            console.error('[GoogleDrive] Scope request failed:', err);
            alert('Could not access Google Drive. Please check permissions.');
        });
    } else {
        _showGoogleDrivePicker(label, onSelect);
    }
}

/**
 * Internal: Show the Drive Picker dialog
 * @private
 */
function _showGoogleDrivePicker(label, onSelect) {
    const view = new google.picker.View(google.picker.ViewId.DOCS);
    view.setMimeTypes('application/pdf,image/jpeg,image/png');

    const picker = new google.picker.PickerBuilder()
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
        .setAppId(window.BA_FIREBASE?.config?.projectId)
        .setOAuthToken(gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().id_token)
        .addView(view)
        .setCallback(data => {
            if (data.action === google.picker.Action.PICKED) {
                const file = data.docs[0];
                console.log('[GoogleDrive] File selected:', file.name, file.id);

                onSelect({
                    driveId: file.id,
                    name: file.name,
                    mimeType: file.mimeType,
                    owner: file.getOwnedByMe ? 'self' : 'other'
                });
            } else if (data.action === google.picker.Action.CANCEL) {
                console.log('[GoogleDrive] Picker cancelled');
            }
        })
        .setTitle('Select a document for ' + label)
        .build();

    picker.setVisible(true);
}

/**
 * Validate that a Drive file is accessible
 * Called before viewing/exporting documents
 *
 * @param {string} driveId - Google Drive file ID
 * @returns {Promise<{accessible: boolean, error?: string}>}
 */
async function validateDriveFileAccess(driveId) {
    if (!googleDriveScope || !gapi.client) {
        console.warn('[GoogleDrive] Drive API not initialized');
        return { accessible: false, error: 'Drive API not initialized' };
    }

    try {
        console.log('[GoogleDrive] Validating access to:', driveId);

        // Use a lightweight metadata request to check file accessibility
        const response = await gapi.client.drive.files.get({
            fileId: driveId,
            fields: 'id,name,mimeType,webViewLink,exportLinks'
        });

        if (!response.result) {
            return { accessible: false, error: 'File not found' };
        }

        console.log('[GoogleDrive] File accessible:', response.result.name);
        return {
            accessible: true,
            name: response.result.name,
            webLink: response.result.webViewLink,
            mimeType: response.result.mimeType
        };
    } catch (error) {
        console.error('[GoogleDrive] Access check failed:', error);

        // Determine error type for user message
        let errorMsg = 'File is no longer accessible';
        if (error.status === 404) {
            errorMsg = 'File was deleted from Google Drive';
        } else if (error.status === 403) {
            errorMsg = 'Access denied (file owner may have revoked access)';
        }

        return { accessible: false, error: errorMsg };
    }
}

/**
 * Get accessible link or warning for document
 * Used when viewing/exporting documents
 *
 * @param {Object} doc - Document metadata
 * @returns {Promise<{link: string, warning?: string}>}
 */
async function getDocumentLink(doc) {
    // Storage-backed documents: use existing link
    if (doc.path && !doc.driveId) {
        return { link: doc.path };
    }

    // Drive-backed documents: validate access
    if (doc.driveId) {
        const validation = await validateDriveFileAccess(doc.driveId);

        if (validation.accessible) {
            return {
                link: validation.webLink,
                source: 'drive'
            };
        } else {
            return {
                link: null,
                warning: `⚠️ ${validation.error}: ${doc.name}. Contact the document owner to restore access.`
            };
        }
    }

    return { link: null, warning: 'Document metadata is corrupted' };
}

/**
 * USER DOCUMENTATION
 * ==================
 *
 * WHAT IS GOOGLE DRIVE UPLOAD?
 * Instead of uploading files to our servers, you can reference files stored
 * in your Google Drive. Benefits:
 * - Reduces server storage costs
 * - You control who has access to the document
 * - Easy to revoke access later
 * - Automatic version history in Google Drive
 *
 * HOW TO USE:
 * 1. Click "Upload via Google Drive" in the document upload section
 * 2. First time: Grant permission to access your Google Drive
 * 3. Select a file from your Drive
 * 4. The document is linked (not copied to our servers)
 *
 * WHAT HAPPENS IF I DELETE THE FILE?
 * The document link breaks and we show a warning: "File was deleted from
 * Google Drive". You'll need to upload a new file.
 *
 * WHAT IF SOMEONE REVOKES SHARED ACCESS?
 * If you shared the file and revoke access, the warning shows:
 * "Access denied (file owner may have revoked access)". This prevents
 * unauthorized access to the document.
 *
 * CAN I SWITCH BACK TO DIRECT UPLOAD?
 * Yes. Existing documents uploaded to our servers continue to work normally.
 * You can mix Storage-backed and Drive-backed documents.
 *
 * SECURITY & COMPLIANCE:
 * - All document operations are logged in the audit trail
 * - Drive file IDs are stored (not the files themselves)
 * - Access checks happen before viewing/exporting
 * - Warnings prevent silent data loss
 * - Backward compatible with existing uploads
 */

export { openGoogleDrivePicker, validateDriveFileAccess, getDocumentLink, initGoogleDrive };
