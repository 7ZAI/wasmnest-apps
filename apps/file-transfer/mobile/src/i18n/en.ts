/**
 * File Transfer plugin English translations
 *
 * Kept in sync with zh-CN at compile time via the plugin's messages index.
 */

import type { MessageSchema } from './messages'

export default {
  // ==================== Toolbox entry ====================
  'transfer.toolbox.title': 'File Transfer',
  'transfer.toolbox.subtitle': 'Fast file transfer over LAN',
  'transfer.toolbox.online': 'Peer online',
  'transfer.toolbox.activeCount': '{count} transferring',
  'transfer.toolbox.disconnected': 'Not connected',

  // ==================== Peer status ====================
  // Top bar connection status: connection-layer only
  'transfer.peer.online': 'Connected',
  'transfer.peer.offline': 'Not connected',
  // Business-layer peer sharing: used as the empty-state title; drop the
  // "Connected" prefix so it doesn't collide with the top bar's meaning.
  'transfer.peer.notSharing': 'Peer not sharing',
  'transfer.peer.unpaired': 'No device connected',
  // Connected but peer announcement not received yet: placeholder name
  'transfer.peer.unknown': 'Unknown device',

  // ==================== Nearby devices sheet ====================
  'transfer.devices.title': 'Nearby Devices',
  'transfer.devices.subtitle': 'WasmNest nodes on this network',
  'transfer.devices.relayEmptyHint':
    'Devices on the same relay appear automatically (configure the same relay on both ends; the relay must support auto-discovery).',
  'transfer.devices.empty':
    'No nearby devices found; make sure the other device has WasmNest open and is on the same network',
  'transfer.devices.online': 'Online',
  'transfer.devices.recentSeen': 'Recently seen',
  'transfer.devices.connected': 'Connected',
  'transfer.devices.connecting': 'Connecting…',
  'transfer.devices.connectingHint': 'Connecting… (the other side may need to confirm)',
  'transfer.devices.sendFile': 'Send file',
  'transfer.devices.capNone': 'No transfer',
  'transfer.devices.activeCurrent': 'Current',
  'transfer.devices.setActive': 'Set active',
  'transfer.devices.disconnect': 'Disconnect',
  'transfer.devices.denied': 'Connection rejected by the other device',
  'transfer.devices.unreachable': 'Cannot connect; the device may be offline',
  'transfer.devices.trustHint':
    'First-time connections need approval on the other side; manage trust in Settings → Trusted peers',
  'transfer.devices.discover': 'Rediscover',
  'transfer.devices.discovering': 'Discovering…',
  'transfer.devices.connectLan': 'LAN',
  'transfer.devices.connectLanHint':
    'Use LAN addresses only; failures never switch to relay automatically',
  'transfer.devices.connectWan': 'Relay',
  'transfer.devices.connectWanHint': 'Dial through the relay directly (only when you ask)',
  'transfer.devices.modeBoth': 'LAN + relay',
  'transfer.devices.modeLanOnly': 'LAN only',
  'transfer.devices.modeWanOnly': 'Relay only',
  'transfer.devices.modeNone': 'No path',
  'transfer.devices.modeNoneHint':
    'No dialable address yet; rediscover or forget the device and retry',
  // T12: relay / remote devices
  'transfer.devices.remote': 'Remote',
  'transfer.devices.removeRemote': 'Forget',
  'transfer.devices.transportLan': 'LAN direct',
  'transfer.devices.transportWan': 'Relay',
  // T20: last transport / WAN capability / classified failure exits
  'transfer.devices.lastTransportLan': 'Last: LAN direct',
  'transfer.devices.lastTransportWan': 'Last: relay',
  'transfer.devices.relayTag': 'Relay',
  'transfer.devices.errorNoEndpoint':
    'No dialable address; rediscover or forget the device and retry',
  'transfer.devices.errorRelayDisabled': 'Relay is off: enable "Relay (WAN)" in settings and retry',
  'transfer.devices.errorRelayUnreachable':
    'Relay path unreachable: check the relay and whether the peer is online',
  'transfer.devices.errorTimeout': 'Connection timed out, please retry',
  'transfer.devices.errorUnknown': 'Connection failed: {detail}',

  // ==================== My device (settings: name / fingerprint) ====================
  'transfer.myDevice.title': 'My device',
  'transfer.myDevice.loading': 'Reading device info…',
  'transfer.myDevice.loadFailed': 'Failed to read device info, please retry',
  'transfer.myDevice.refresh': 'Retry',
  'transfer.myDevice.unsupportedTitle': 'Host not supported',
  'transfer.myDevice.unsupportedBody':
    'The current host provides no device identity; upgrade the host and retry.',
  'transfer.myDevice.deviceName': 'Device name',
  'transfer.myDevice.unnamed': 'Unnamed device',
  'transfer.myDevice.fingerprint': 'Fingerprint',
  'transfer.myDevice.hint':
    'The other device identifies this one by name and fingerprint in its nearby-device list.',

  // ==================== Top bar / browsing ====================
  'transfer.topbar.settings': 'Settings',
  'transfer.topbar.closeSettings': 'Back',
  'transfer.topbar.refresh': 'Refresh',
  'transfer.topbar.queryPeer': 'Re-detect peer',
  'transfer.topbar.downloadSelected': 'Download ({count} · {size})',
  'transfer.topbar.uploadFile': 'Upload file',
  'transfer.topbar.connectDevice': 'Connect (nearby devices)',
  'transfer.breadcrumb.home': 'Files',
  'transfer.table.empty': 'This folder is empty',
  'transfer.table.loading': 'Loading...',
  'transfer.table.dirUnavailable': 'This folder is currently unavailable',
  'transfer.table.selectAll': 'Select all',
  'transfer.table.clearSelection': 'Clear selection',

  // ==================== Task states (spec 9.3 four-color) ====================
  'transfer.task.state.queued': 'Queued',
  'transfer.task.state.awaitingPeer': 'Waiting for peer',
  'transfer.task.awaitingPeerHint':
    'Waiting for the other device to accept — transfer starts automatically once accepted.',
  'transfer.task.state.transferring': 'Transferring',
  'transfer.task.state.paused': 'Paused',
  'transfer.task.state.resumable': 'Resumable',
  'transfer.task.state.completed': 'Completed',
  'transfer.task.state.failed': 'Failed',
  'transfer.task.state.rejected': 'Rejected',
  'transfer.task.state.cancelled': 'Cancelled',
  'transfer.task.state.interrupted': 'Interrupted (app restarted)',
  'transfer.task.pause': 'Pause',
  'transfer.task.resume': 'Resume',
  'transfer.task.cancel': 'Cancel',
  'transfer.task.cancelledToast': 'Task cancelled',
  'transfer.task.remove': 'Remove task',
  'transfer.task.open': 'Open',
  'transfer.task.retry': 'Retry',
  'transfer.task.resumeAll': 'Resume all',
  'transfer.task.download': 'Download',
  'transfer.task.upload': 'Upload',
  'transfer.task.empty': 'No transfer tasks',
  'transfer.task.progress': '{done} / {total}',
  'transfer.task.reason.duplicateName':
    'A file with the same name already exists in the target folder',
  'transfer.task.reason.remoteChanged':
    "The remote file has changed and can't be resumed. Please start over.",
  'transfer.task.reason.dirUnavailable': 'This folder is currently unavailable',
  'transfer.task.reason.noRoots': 'The remote device has not shared any folders',
  'transfer.task.reason.localNotFound': 'Local file not found',
  'transfer.task.reason.cancelledBySender': 'Cancelled by the sender',
  'transfer.task.reason.cancelledByReceiver': 'Cancelled by the receiver',
  'transfer.task.reason.cancelledBySelf': 'Cancelled by you',
  'transfer.task.reason.unknown': 'Transfer failed',

  // ==================== Mini transfer bar ====================
  'transfer.minibar.noActive': 'No active transfers',
  'transfer.minibar.speed': '{speed}/s',
  'transfer.minibar.openQueue': 'View queue',

  // ==================== Pull to refresh ====================
  'transfer.pull.pull': 'Pull to refresh',
  'transfer.pull.ready': 'Release to refresh',
  'transfer.pull.refreshing': 'Refreshing…',

  // ==================== Queue bottom sheet ====================
  'transfer.queue.title': 'Transfer queue',
  'transfer.queue.entry': '{count} tasks',
  'transfer.queue.active': '{count} active',
  'transfer.queue.rejectedChip': 'Rejected',
  'transfer.queue.failedChip': 'Failed',

  // ==================== Settings ====================
  'transfer.settings.title': 'File Transfer Settings',
  'transfer.settings.sharedRoots': 'Shared folders',
  'transfer.settings.pickRoot': 'Pick folder',
  'transfer.settings.picking': 'Picking…',
  'transfer.settings.pickFailed':
    'Failed to add: folder selection incomplete or authorization failed. Try again.',
  'transfer.settings.pickUnsupported':
    'The system directory picker is Android-only and unavailable here.',
  'transfer.settings.rootDuplicate': 'This folder is already in the share list',
  'transfer.settings.rootInvalid': 'Invalidated',
  'transfer.settings.reauthorize': 'Re-authorize',
  'transfer.settings.reauthorized': 'Re-authorized',
  'transfer.settings.freeBadge': 'No auth needed',
  'transfer.settings.specialEntryHint':
    'The "No auth needed" entry is the app private downloads folder (the only auth-free shared entry, always visible).',
  'transfer.settings.removeRoot': 'Remove',
  'transfer.settings.noRoots': "No shared folders yet. The remote device won't see your files.",
  'transfer.settings.downloadDir': 'Download folder',
  'transfer.settings.noDownloadDir': 'Not set',
  'transfer.settings.downloadDirHint': 'Downloads are saved to the system Downloads folder',
  'transfer.settings.openDownloadDir': 'Open',
  'transfer.settings.openDownloadDirOpening': 'Opening…',
  'transfer.settings.openDownloadDirFailed': 'Failed to open the download folder',
  'transfer.settings.concurrency': 'Concurrency',
  'transfer.settings.concurrencyHint': 'Number of files transferred at once (1–8)',
  'transfer.settings.saved': 'Settings saved',

  // ==================== Upload page (shared directories) ====================
  'transfer.upload.title': 'Upload file',
  'transfer.upload.chooseRoot': 'Choose a shared folder',
  'transfer.upload.noRoots': 'No shared folders yet. Add one in Settings first.',
  'transfer.upload.openSettings': 'Open Settings',
  'transfer.upload.emptyDir': 'This folder is empty',
  'transfer.upload.loading': 'Loading...',
  'transfer.upload.dirUnavailable': 'This folder is currently unavailable',
  'transfer.upload.rootInvalid': 'This shared folder is invalid. Re-authorize it.',
  'transfer.upload.reauthorize': 'Re-authorize',
  'transfer.upload.reauthorized': 'Re-authorized',
  'transfer.upload.backToRoots': 'Back to shared folders',
  'transfer.upload.specialBadge': 'No auth needed',
  'transfer.upload.specialEntryHint': 'App private downloads folder (no auth needed)',
  'transfer.upload.enqueueFailed': 'Enqueue failed. Try again.',
  'transfer.upload.enqueued': 'Added to the upload queue',
  'transfer.upload.offline': 'The peer is offline; cannot upload',

  // ==================== Save to… (M3 single-file destination) ====================
  'transfer.saveTo.title': 'Save to…',
  'transfer.saveTo.enqueued': 'Added to download queue; choose a location when done',
  'transfer.saveTo.saved': 'Saved to the selected location',
  'transfer.saveTo.failed': 'Save failed or cancelled; file kept in app downloads',

  // ==================== Dialog / notification ====================
  'transfer.dialog.duplicateTitle': 'Upload failed',
  'transfer.dialog.gotIt': 'Got it',
  'transfer.dialog.cancel': 'Cancel',
  'transfer.notify.doneTitle': 'Transfers complete',
  'transfer.notify.doneBody': '{count} file(s) transferred successfully',
  'transfer.notify.failedTitle': 'Some transfers failed',
  'transfer.notify.failedBody': '{count} file(s) failed. Check the queue.',

  // ==================== Errors (spec §10) ====================
  'transfer.error.duplicateName':
    'Upload failed: a file with the same name already exists in the target folder',
  'transfer.error.remoteChanged':
    "The remote file has changed and can't be resumed. Please start over.",
  'transfer.error.dirUnavailable': 'This folder is currently unavailable',

  // ==================== Empty states ====================
  'transfer.empty.noRoots': 'The remote device has not shared any folders',
  'transfer.empty.noDownloadDir': 'Configure a download folder in Settings first',
  'transfer.empty.emptyDirHint': "No files in the peer's shared folder yet",
  'transfer.empty.notSharingHint': 'Ask the peer to enable file sharing',
  'transfer.empty.unavailableHint': 'The peer may be offline or the folder was removed',

  // ==================== Peer storage permission notice ====================
  'transfer.notice.storageAccessTitle': 'The peer may not have storage access granted',
  'transfer.notice.storageAccess':
    'The shared folder lives in Android top-level storage, which requires "All files access" to read. Grant it in System settings → Apps → WasmNest → Allow all files',

  // ==================== Units ====================
  'transfer.size.bytes': '{value} B',
  'transfer.size.kb': '{value} KB',
  'transfer.size.mb': '{value} MB',
  'transfer.size.gb': '{value} GB',
  'transfer.time.justNow': 'Just now',
  'transfer.time.minutesAgo': '{count} min ago',
  'transfer.time.hoursAgo': '{count} hr ago',

  // ==================== v2 queue tabs / batch approval / receiving / history ====================
  'transfer.queue.all': 'All',
  'transfer.queue.sending': 'Sending',
  'transfer.queue.receiving': 'Receiving',
  'transfer.queue.history': 'History',
  'transfer.queue.emptyHistory': 'No transfer history',
  'transfer.task.waitingApproval': 'Waiting for approval',
  'transfer.task.receiving': 'Receiving',
  'transfer.batch.pendingTitle': 'File transfer request',
  'transfer.batch.acceptAll': 'Accept all',
  'transfer.batch.rejectAll': 'Reject all',
  'transfer.request.title': 'File transfer request',
  'transfer.request.body': '{name} wants to send you {count} files ({size} total)',
  'transfer.request.countdown': 'Auto-reject in {seconds}s',
  'transfer.request.acceptAll': 'Accept all',
  'transfer.request.rejectAll': 'Reject all',
  'transfer.toast.receiving': '{name} is sending you {count} files',
  'transfer.error.rejectedByUser': 'The transfer was rejected by the peer',
  'transfer.error.noResponse': 'No response from the peer; the request timed out',
  'transfer.error.policyDenied': 'The peer is set to reject incoming transfers',
  'transfer.history.title': 'History',
  'transfer.history.clear': 'Clear history',
  'transfer.history.empty': 'No transfer history',
  'transfer.history.openFolder': 'Show in folder',
  'transfer.history.clearConfirmTitle': 'Clear transfer history?',
  'transfer.history.clearConfirmMessage':
    'All history entries (sent and received) will be deleted. This cannot be undone.',
  'transfer.history.clearConfirmAction': 'Clear',
  'transfer.history.results.completed': 'Completed',
  'transfer.history.results.failed': 'Failed',
  'transfer.history.results.rejected': 'Rejected',
  'transfer.history.results.cancelled': 'Cancelled',
  'transfer.settings.receivingPolicy': 'Receiving policy',
  'transfer.settings.receivingPolicyAsk': 'Ask every time',
  'transfer.settings.receivingPolicyAccept': 'Accept automatically',
  'transfer.settings.receivingPolicyReject': 'Reject automatically',
  'transfer.settings.receivingPolicyHint': 'Whether to ask before receiving files from peers',
  'transfer.settings.encryption': 'Transfer encryption',
  'transfer.settings.encryptionAlwaysOn': 'Always encrypted',
  'transfer.settings.encryptionHint':
    'Every transfer (LAN or relay) is encrypted and cannot be turned off; the peer must support encryption',
  'transfer.settings.approvalTimeout': 'Approval timeout (s)',
  // T12: relay switch and prompt threshold (turning relay off never affects encryption)
  'transfer.settings.relay': 'Relay (WAN)',
  'transfer.settings.relayOn': 'Allow',
  'transfer.settings.relayOff': 'LAN only',
  'transfer.settings.relayHint':
    'Allowing relay only adds relay candidates to dialing; encryption stays on either way',
  'transfer.settings.relayThreshold': 'Relay prompt threshold (MB)',
  'transfer.settings.relayThresholdHint':
    'Warn once before sending over relay when the batch is at least this large; 0 = warn every time',

  // ==================== Relay send hint (T12) ====================
  'transfer.relayHint.title': 'Sending over relay',
  'transfer.relayHint.body':
    'This connection goes through a relay, so large files may be slower. Encryption stays on. Continue?',
  'transfer.relayHint.confirm': 'Continue',
  'transfer.relayHint.cancel': 'Cancel',

  // ==================== Relay config (settings, read-only + QR import) ====================
  'transfer.relayConfig.title': 'Relay configuration',
  'transfer.relayConfig.loading': 'Loading relay configuration…',
  'transfer.relayConfig.loadFailed': 'Failed to load relay configuration, please retry',
  'transfer.relayConfig.refresh': 'Reload',
  'transfer.relayConfig.emptyTitle': 'No external access yet',
  'transfer.relayConfig.empty':
    'Scan a relay configuration shared by another device; skip this for LAN-only use.',
  'transfer.relayConfig.addresses': 'Relay addresses',
  'transfer.relayConfig.showAddr': 'Show full address',
  'transfer.relayConfig.hideAddr': 'Hide address',
  'transfer.relayConfig.source': 'Source',
  'transfer.relayConfig.sourceCenter': 'Network center',
  'transfer.relayConfig.sourceCache': 'Local cache',
  'transfer.relayConfig.sourceInvite': 'Imported invite',
  'transfer.relayConfig.sourceQr': 'Imported QR',
  'transfer.relayConfig.sourceSync': 'Synced on LAN',
  'transfer.relayConfig.sourceUnknown': 'Unspecified',
  'transfer.relayConfig.relayState': 'Relay state',
  'transfer.relayConfig.stateIdle': 'Disabled',
  'transfer.relayConfig.stateConnecting': 'Connecting…',
  'transfer.relayConfig.stateReserved': 'Ready',
  'transfer.relayConfig.stateLost': 'Lost (retrying)',
  'transfer.relayConfig.stateUnknown': 'Unknown',
  'transfer.relayConfig.room': 'Room code',
  'transfer.relayConfig.syncedAt': 'Fetched at',
  'transfer.relayConfig.centerError': 'Could not read relay configuration: {message}',
  'transfer.relayConfig.scanImport': 'Scan configuration',
  'transfer.relayConfig.scanTitle': 'Scan relay configuration',
  'transfer.relayConfig.scanHint':
    'Point at the share QR in Settings → Relay configuration on the other device',
  'transfer.relayConfig.scanHintSlow':
    'No QR detected yet: move closer, or raise the screen brightness on the other device',
  'transfer.relayConfig.scanClose': 'Close',
  'transfer.relayConfig.scanRetry': 'Retry',
  'transfer.relayConfig.scanFailed': 'Cannot start the camera',
  'transfer.relayConfig.scanPermission':
    'Camera permission denied; allow camera access for this app in system settings and retry',
  'transfer.relayConfig.confirmTitle': 'Import this relay configuration?',
  'transfer.relayConfig.confirmReplace': 'Current relay addresses / room code will be replaced.',
  'transfer.relayConfig.import': 'Import',
  'transfer.relayConfig.importing': 'Importing…',
  'transfer.relayConfig.cancel': 'Cancel',
  'transfer.relayConfig.importFailed':
    'Import failed: addresses or room code were rejected, please retry',
  'transfer.relayConfig.imported': 'Relay configuration imported',
  'transfer.relayConfig.syncNow': 'Sync from connected device',
  'transfer.relayConfig.syncing': 'Syncing…',
  'transfer.relayConfig.syncSynced': 'Relay configuration synced from peer',
  'transfer.relayConfig.syncNoPeer': 'No active device; connect one in Nearby devices first',
  'transfer.relayConfig.syncNotTrusted': 'This device is not trusted; sync refused',
  'transfer.relayConfig.syncNotConnected': 'Peer is not connected; connect before syncing',
  'transfer.relayConfig.syncNoConfig': 'Peer has no relay configured; nothing to sync',
  'transfer.relayConfig.syncInvalidConfig': 'Peer configuration failed validation; refused',
  'transfer.relayConfig.syncUnsupported':
    'This host runtime does not support peer config sync; upgrade the host',
  'transfer.relayConfig.syncFailed': 'Sync failed, please retry',

  'transfer.relayCard.conflict.title': 'Global relay differs from this space',
  'transfer.relayCard.conflict.body':
    'Auto-discovery will not work. Switch the relay in Network to this space, or ask the other side to use yours.',
  'transfer.relayCard.unconfigured.title': 'Cross-network not configured',
  'transfer.relayCard.unconfigured.body':
    'A relay is required. Open Network to enter an address, or scan a shared configuration.',
  'transfer.relayCard.connecting.title': 'Connecting to the relay…',
  'transfer.relayCard.connecting.body':
    'The first connection may take a few seconds; devices in the same space will appear automatically.',
  'transfer.relayCard.lost.title': 'Relay unreachable',
  'transfer.relayCard.lost.body': 'Check the relay address, network and relay process, then retry.',
  'transfer.relayCard.disabled.title': 'Relay disabled',
  'transfer.relayCard.disabled.body':
    'Check the “allow relay” switch or the relay address; when off, only LAN is used.',
  'transfer.relayCard.unsupported.title': 'Relay does not support discovery',
  'transfer.relayCard.unsupported.body':
    'Upgrade to a relay version that supports device discovery, then retry.',
  'transfer.relayCard.denied.title': 'Relay rejected this device',
  'transfer.relayCard.denied.body':
    'Allowlist mode requires enrollment first; check the relay configuration.',
  'transfer.relayCard.error.title': 'Discovery query failed',
  'transfer.relayCard.error.body': '{detail}',
  'transfer.relayCard.unavailable.title': 'Relay not ready',
  'transfer.relayCard.unavailable.body':
    'It will retry once the relay reservation is ready; you can also refresh manually.',

  'transfer.relayCard.pending.title': 'Checking discovery status',
  'transfer.relayCard.pending.body':
    'Refresh to query again; older hosts may not report discovery status.',
  'transfer.relayCard.roomHint': 'No space code: every device on this relay is visible.',
  'transfer.relayCard.stale': 'Status may be stale; refresh to retry.',
  'transfer.relayCard.actionShareConfig': 'Share configuration',
  'transfer.relayCard.actionRefresh': 'Refresh',
  'transfer.relayCard.actionCenter': 'Open Network',
  'transfer.relayCard.actionSettings': 'Open settings',
  'transfer.relayCard.openCenterUnavailable':
    'This host cannot navigate; open Network from the sidebar.',

  // ==================== 首连确认（全局对话框，spec 决策 7） ====================
  'transfer.consent.title': 'Connection request',
  'transfer.consent.body': '{name} wants to connect to your device for file transfer',
  'transfer.consent.fingerprint': 'Device fingerprint: {fingerprint}',
  'transfer.consent.timeoutHint': 'Auto-reject if unanswered in {seconds}s',
  'transfer.consent.namelessHint':
    'The device name could not be verified; check the fingerprint before deciding',
  'transfer.consent.trust': 'Trust',
  'transfer.consent.deny': 'Deny',
  'transfer.consent.autoTrustedToast': 'Auto-trusted paired device {name}',

  // ==================== Trusted peers (spec decision 8) ====================
  'transfer.trusted.title': 'Trusted peers',
  'transfer.trusted.loading': 'Loading...',
  'transfer.trusted.empty':
    'No trusted peers yet; trust is established after the first approved connection',
  'transfer.trusted.loadFailed': 'Failed to load trusted peers',
  'transfer.trusted.retry': 'Retry',
  'transfer.trusted.addedAt': 'Added: {time}',
  'transfer.trusted.revoke': 'Revoke',
  'transfer.trusted.cancel': 'Cancel',
  'transfer.trusted.revokeTitle': 'Revoke trust',
  'transfer.trusted.revokeBody':
    'After revoking, {name} will need your approval again on the next connection. Revoke trust for this device?',
  'transfer.trusted.revokeFailed': 'Revoke failed; please try again later',
  'transfer.trusted.revokedToast': 'Revoked trust for {name}',

  // ==================== Bottom nav + top-level pages (Transfers / Browse / Discover) ====================
  'transfer.v2.tab.transfers': 'Transfers',
  'transfer.v2.tab.browse': 'Browse',
  'transfer.v2.tab.devices': 'Discover',
  'transfer.v2.nav.settings': 'Settings',
  'transfer.v2.filter.all': 'All',
  'transfer.v2.filter.sending': 'Sending',
  'transfer.v2.filter.receiving': 'Receiving',
  'transfer.v2.filter.history': 'History',
  'transfer.v2.upload.cta': 'Upload file',
  'transfer.v2.upload.short': 'Send',
  'transfer.v2.queue.hint': '{count} in queue',
  'transfer.v2.active.overall': 'Overall {percent}%',
  'transfer.v2.active.viewQueue': 'View queue',
  'transfer.v2.devices.subtitle': 'WasmNest nodes on the same network',
  'transfer.v2.devices.scanningTitle': 'Searching for nearby devices…',
  'transfer.v2.devices.scanningHint':
    'Make sure the other device has WasmNest open on the same network',
  'transfer.v2.devices.found': '{count} device(s) found',
  'transfer.v2.devices.groupConnected': 'Connected',
  'transfer.v2.devices.groupNearby': 'Nearby devices',
  'transfer.v2.devices.emptyTitle': 'No devices yet',
  'transfer.v2.pendingRequests': '{count} pending request(s)',
  'transfer.v2.history.openFolder': 'Open containing folder',
  'transfer.v2.history.noLocalFile':
    'Could not open the containing folder: file not found (it may have been moved, deleted, or the download folder has changed)',
  'transfer.history.allFilesAccess.title': 'All files access required',
  'transfer.history.allFilesAccess.message':
    'Opening the system Downloads folder requires the "All files access" permission (Settings → Apps → Special access → All files access). Some devices do not offer this switch; in that case WasmNest automatically shows a mirrored folder view of your downloads, no permission needed.',
  'transfer.history.allFilesAccess.cancel': 'Cancel',
  'transfer.history.allFilesAccess.goToSettings': 'Open settings',
  'transfer.history.allFilesAccess.after':
    'Enable "All files access" in system settings, then tap "Show in folder" again',
} satisfies MessageSchema
