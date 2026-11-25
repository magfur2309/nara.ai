# Security Specification — SOP Brain

## 1. Data Invariants
1. **Verified Identity Only**: Every read/write requires `request.auth != null && request.auth.token.email_verified == true`.
2. **PII Isolation**: Raw user `email` is stored exclusively in `/users/{userId}` and readable only by the owner (`request.auth.uid == userId`) or a `Super Admin`. Non-PII colleague lookup uses `/directory/{userId}`.
3. **Self-Assigned Role Prevention**: During `/users/{userId}` creation, a non-bootstrap user MUST have `role == 'Karyawan'`. Only the bootstrapped Super Admin (`ahmadmagfur1218@gmail.com`) or an existing `Super Admin` can assign elevated roles (`Super Admin`, `Admin Divisi`, `Penulis`).
4. **Access-Control Enforcement in Rules**:
   - `Umum` SOPs with `status == 'Disetujui'` are readable by verified employees.
   - `Draft`/`Review`/`Arsip` SOPs are NOT readable by regular `Karyawan` users unless they are the creator/owner/reviewer.
   - `Per Divisi` and `Rahasia` SOPs and `sopChunks` restrict `list` and `get` via `viewerUids` / `ownerUid` / `createdByUid` / `Super Admin` without `get()` inside `allow list`.
5. **Approval Gate**: Only `Super Admin` or `Admin Divisi` (for their division) can transition an SOP's `status` to `'Disetujui'` or `'Arsip'`. `Penulis` cannot self-approve drafts.
6. **Immutable Versioning**: `/sops/{sopId}/versions/{versionId}` snapshots cannot be modified after creation.
7. **Temporal & Schema Integrity**: All `createdAt` / `updatedAt` timestamps must equal `request.time`. All strings/arrays have strict `.size()` bounds and strict `keys().hasAll(...)` / `keys().hasOnly(...)` checks.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Privilege Escalation on Signup**: Regular user creates `/users/uid_attacker` with `role: "Super Admin"`.
2. **PII Blanket Read**: Regular employee calls `list` or `get` on `/users/uid_victim` to scrape email addresses.
3. **Directory Role Spoof**: Regular employee writes `/directory/uid_attacker` with `role: "Admin Divisi"`.
4. **Shadow Field Injection on SOP**: Penulis creates `/sops/sop_1` with extra ghost field `isBypassed: true`.
5. **Penulis Self-Approval**: Penulis updates `/sops/sop_1` changing `status` from `"Draft"` to `"Disetujui"`.
6. **Unauthorized Cross-Division Approval**: Admin Divisi A updates SOP belonging to Divisi B to `"Disetujui"`.
7. **Confidential SOP Enumeration**: Regular employee not in `viewerUids` calls `get` or `list` on a `Rahasia` SOP or `sopChunk`.
8. **Unapproved Chunk Indexing**: Non-admin creates a `sopChunks` document with `status: "Draft"`.
9. **ID Poisoning**: Attacker creates `/sops/<2000-char-invalid-id>` with non-alphanumeric characters.
10. **Timestamp Backdating**: Attacker creates `/sops/sop_1` with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
11. **Chat Session Hijacking**: Attacker reads or writes `/chatSessions/victim_session/messages/msg_1` owned by another user.
12. **Version Tampering**: Attacker updates an existing `/sops/sop_1/versions/v1` document to alter historical audit logs.
13. **Orphaned Maintenance Schedule**: User attempts to create `/maintenanceSchedules/mnt_orphan` referencing a non-existent `assetId`.
14. **Asset Shadow Field & Role Bypass**: Regular `Karyawan` attempts to create/delete `/assets/ast_1` or inject an unauthorized field `approved: true`.
15. **Asset ID Tampering on Schedule Update**: PIC attempts to mutate immutable `assetId` or `createdByUid` when marking a maintenance task completed.

