# Google Drive Integration Guide

## Overview

The BA Express Driver Vetting Tracker now supports **Google Drive document linking** alongside traditional Storage uploads. Users can choose how to manage each document:

- **Storage**: Upload directly to our servers (default, works offline)
- **Google Drive**: Reference files from your Google Drive (shared access, version history)

## For Users

### When to Use Google Drive

✅ **Use Google Drive when:**
- Document owner needs to control sharing/permissions
- You want automatic version history and recovery
- You prefer not to store files on external servers
- Multiple people need to collaborate on a document

✅ **Use Direct Upload when:**
- Document should stay on our servers only
- You don't have a Google Drive account
- Maximum privacy/data localization
- Offline access needed (Drive requires internet)

### How to Link a Google Drive Document

1. **Open a case** in the BA Express Vetting Tracker
2. **Scroll to the document section** (e.g., "Identity Document")
3. **Click "Google Drive" button** next to "Upload to Storage"
4. **First time only**: Grant permission to access your Google Drive
   - This is a "lazy permission" — you grant it only when needed, not at login
   - We request: `View only` access to your Drive files
5. **Select a document** from your Google Drive (PDF, JPG, PNG)
6. **Document linked** — the link is saved to the case

### What Happens to the File?

- **Storage**: File is uploaded and stored on our servers (default)
- **Google Drive**: Only a reference/link is saved — your file stays in Google Drive

This means:
- You can update the file in Google Drive, and the case always references the latest version
- You control who has access via Google Drive sharing
- If you delete the file, the case shows a warning

### If Something Goes Wrong

#### "File was deleted from Google Drive"
The document owner deleted the file. You need to:
1. Contact the owner to recover it from Google Drive's trash
2. Or upload a new document

#### "Access denied (file owner may have revoked access)"
The document owner revoked shared access. You need to:
1. Ask the owner to reshare the file with you
2. Or upload a new document

#### "File is no longer accessible"
The file may be corrupted or the Drive owner's account suspended. Contact the document owner.

---

## For Administrators

### Architecture

**Lazy Scope Negotiation**
- Google Drive permission is requested **on first use**, not at login
- Reduces friction and scope bloat
- User sees prompt: "Grant permission to Google Drive"
- Scope: `https://www.googleapis.com/auth/drive.readonly`

**Document Storage**
- Firestore stores: `{ driveId, fileName, mimeType, source: 'drive' }`
- File stays in user's Google Drive
- Reference-based, not copy-based

**Access Validation**
- Before viewing: lightweight HEAD request to Drive API
- Checks if file is accessible
- Shows warning if file was deleted or access revoked
- No file download until user clicks "View"

**Backward Compatibility**
- Existing Storage-backed documents work unchanged
- Mix and match Storage + Drive documents in same case
- Migration is transparent to users

### Configuration Requirements

#### 1. Google Cloud Project Setup

```
1. Go to https://console.cloud.google.com
2. Select your Firebase project (vetting-63c6d)
3. APIs & Services > Credentials
4. Create OAuth 2.0 Client ID (Web application)
5. Authorized JavaScript origins:
   - https://yourdomain.com (production)
   - http://localhost:8000 (development)
6. Download the client ID
```

#### 2. Update firebase-config.js

```javascript
window.BA_FIREBASE = {
    config: { /* existing Firebase config */ },
    workspaceId: "ba-express-vetting",
    googleDriveClientId: "YOUR_CLIENT_ID.apps.googleusercontent.com"
};
```

#### 3. Google Drive API Permissions

In Google Cloud Console:
- Enable: **Google Drive API**
- Enable: **Google Picker API**

#### 4. Update Google Auth Scopes

Firebase Auth needs the Drive scope. Update your Google Sign-In configuration to include:
```javascript
scopes: ['profile', 'email']
// Drive scope is requested dynamically on first use
```

### Cost Implications

**API Costs:**
- Drive file list: ~$0.003 per 100 calls
- File metadata check: ~$0.003 per 100 calls
- Free tier: 10,000 calls/day per user

**At scale (1000 users):**
- ~30 Drive API calls/day = $0.0009/day
- ~$0.27/month for API costs

**Storage savings:**
- 1000 cases × 5 documents × 5MB = 25GB saved
- Firebase Storage cost reduction: ~$0.50/month

**Net savings: Yes** (API costs << Storage costs for typical usage)

### Audit Trail

All document operations are logged:

```javascript
// When document linked
recordAudit(v, 'document', [{
    field: 'Identity Document',
    before: '—',
    after: 'Passport.pdf (Google Drive)'
}]);

// When document viewed
recordAudit(v, 'document_viewed', [{
    field: 'Identity Document',
    before: '—',
    after: 'Passport.pdf (Drive) - View'
}]);

// When access fails
recordAudit(v, 'document_access_failed', [{
    field: 'Identity Document',
    before: 'Passport.pdf',
    after: 'Access denied: File was deleted'
}]);
```

### Monitoring & Alerts

**Recommended monitoring:**
- Track: Documents with "access_failed" events
- Alert: When > 5% of Drive documents fail access checks (indicates API issues)
- Metric: Average Drive API response time (should be < 200ms)

### Troubleshooting

#### Issue: "Google Drive is not available"
- **Cause**: Google API script failed to load
- **Fix**: Check browser network tab for blocked resources
- **Fallback**: Users can use direct upload instead

#### Issue: "Could not access Google Drive"
- **Cause**: User denied permission or account issue
- **Fix**: Ask user to re-authenticate or check account
- **Workaround**: Use direct upload instead

#### Issue: High Drive API error rate
- **Cause**: Quota exceeded or API misconfigured
- **Fix**: Check Google Cloud quotas, verify API keys
- **Fallback**: Show warning to users, recommend direct upload

---

## Technical Details

### File Validation Flow

```
User clicks "View" on Drive document
    ↓
validateDriveFileAccess(driveId)
    ├─ Make Drive API request: GET /files/{id}
    ├─ Check if file exists (404 = deleted)
    ├─ Check if user has access (403 = revoked)
    ├─ Get webViewLink (Google Drive preview)
    ↓
If accessible:
    └─ window.open(webLink, '_blank')
    └─ Record: document_viewed
If not accessible:
    └─ Show warning with error message
    └─ Record: document_access_failed
```

### Document Metadata Schema

**Storage-backed document:**
```javascript
{
    path: "workspaces/ba-express-vetting/drivers/v123/Identity-Doc.pdf",
    fileName: "Identity-Doc.pdf",
    size: 2450000,
    contentType: "application/pdf",
    uploadedAt: 1718097600000,
    uploadedBy: { uid: "...", email: "..." }
}
```

**Drive-backed document:**
```javascript
{
    driveId: "1a2b3c4d5e6f7g8h9i0j",
    fileName: "Passport.pdf",
    mimeType: "application/pdf",
    source: "drive",
    uploadedAt: 1718097600000,
    uploadedBy: { uid: "...", email: "..." }
}
```

### Migration Path

Existing Storage documents continue to work. To migrate to Drive:

```javascript
// Old document
{ path: "...", fileName: "Doc.pdf", ... }

// Just delete old and link new from Drive
// No data conversion needed
```

---

## FAQ

### Can I switch between Storage and Drive for the same document?
Yes. Delete the old one and add the new source. This is logged in audit trail.

### What if Drive file permissions change after linking?
Access is validated **every time** you try to view. If permissions change, you'll get a warning on next view attempt.

### Can I view Drive files if my internet goes down?
No. Drive references require internet. Storage uploads work offline (already downloaded). This is by design.

### Who can see the linked Google Drive file?
Only people you explicitly share it with on Google Drive. The case metadata is separate from the actual file access.

### Can I revoke access after linking?
Yes. Delete the document reference from the case. The Drive file remains in your account.

### What happens when I export a case as PDF?
- Storage documents: Embedded in PDF
- Drive documents: Shown as "Document linked from Google Drive (link)"
- If Drive file is inaccessible: Warning shown in PDF

### Are Drive files scanned for malware?
Yes. Google Drive provides virus scanning for uploads. We don't download the file, so no additional scanning on our end.

---

## Security Considerations

### Data Protection
- ✅ Drive credentials never sent to our servers
- ✅ Only file IDs and links stored in Firestore
- ✅ Actual files remain in Google Drive
- ✅ Our server can't access file content

### Access Control
- ✅ Google Drive's native sharing controls
- ✅ Validated before each view (prevents stale access)
- ✅ Audit trail of all access attempts
- ✅ Warnings on permission revocation

### Compliance
- ✅ Documents stay in user's Google Drive (meets data residency requirements)
- ✅ Audit trail for compliance reporting
- ✅ No additional storage/processing on our servers
- ⚠️ Drive file deletion is beyond our control (user responsibility)

---

## Support & Contact

**Issues with Drive integration?**
- Check: Browser console for errors (F12 → Console tab)
- Try: Reload page and re-authenticate
- Contact: your administrator with error messages

**Feature requests?**
- Export Drive documents: planned for v1.2
- Document preview before linking: planned for v1.2
- Batch Drive uploads: planned for v1.3
