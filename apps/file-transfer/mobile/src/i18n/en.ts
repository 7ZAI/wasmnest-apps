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
    'Devices on the same relay appear automatically (configure the same relay on both ends; the relay must support auto-discovery). QR / link is only needed when a shared relay is unavailable.',
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
  'transfer.devices.connect': 'Connect',
  'transfer.devices.disconnect': 'Disconnect',
  'transfer.devices.denied': 'Connection rejected by the other device',
  'transfer.devices.unreachable': 'Cannot connect; the device may be offline',
  'transfer.devices.trustHint':
    'First-time connections need approval on the other side; manage trust in Settings → Trusted peers',
  'transfer.devices.scan': 'Discover',
  'transfer.devices.scanning': 'Discovering…',
  // T12: relay / remote devices
  'transfer.devices.addRemote': 'Add remote device',
  'transfer.devices.myDevice': 'My device',
  'transfer.devices.remote': 'Remote',
  'transfer.devices.removeRemote': 'Forget',
  'transfer.devices.tryWan': 'Try over relay',
  'transfer.devices.tryWanHint':
    'Only tries the relay when you ask; same-network failures never switch automatically',
  'transfer.devices.transportLan': 'LAN direct',
  'transfer.devices.transportWan': 'Relay',
  // T20: last transport / WAN capability / classified failure exits
  'transfer.devices.lastTransportLan': 'Last: LAN direct',
  'transfer.devices.lastTransportWan': 'Last: relay',
  'transfer.devices.hasRelay': 'Relay ready',
  'transfer.devices.lanOnly': 'LAN only',
  'transfer.devices.relayTag': 'Relay',
  'transfer.devices.relayOnly': 'Relay only',
  'transfer.devices.relayOnlyHint':
    'Skip LAN candidates and dial straight through the relay (faster on cellular)',
  'transfer.devices.errorNoEndpoint': 'No dialable address; add the remote device again',
  'transfer.devices.errorRelayDisabled': 'Relay is off: enable "Relay (WAN)" in settings and retry',
  'transfer.devices.errorRelayUnreachable':
    'Relay path unreachable: check the relay and whether the peer is online',
  'transfer.devices.errorTimeout': 'Connection timed out, please retry',
  'transfer.devices.errorUnknown': 'Connection failed: {detail}',

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

  // ==================== Add remote device (T12) ====================
  'transfer.remote.title': 'Add remote device',
  'transfer.remote.hint':
    'Paste the pairing link (wasmnest://pair/…) or the raw JSON payload from the other device. Only connection info and an optional one-time ticket are carried; long-term keys never are.',
  'transfer.remote.placeholder': 'wasmnest://pair/… or {"nodeId":"…","addrs":["…"]}',
  'transfer.remote.sourceHint':
    'Preferred: configure the same relay on both ends under My device → External access. Devices on the same relay appear automatically — no QR code or link exchange. Use the link / QR below only when both sides cannot share a relay.',
  'transfer.remote.cancel': 'Cancel',
  'transfer.remote.confirm': 'Add',
  'transfer.remote.added': 'Remote device added',
  'transfer.remote.addedWithRelay': 'Added (relay candidate included, works across networks)',
  'transfer.remote.addedLanOnly': 'Added (LAN only)',
  'transfer.remote.scan': 'Scan',
  'transfer.remote.scanTitle': 'Scan to add device',
  'transfer.remote.scanHint':
    'Point this app’s scanner at the pairing QR code on the other device (the system camera will not open this app)',
  'transfer.remote.scanHintSlow':
    'No QR detected yet: move closer, or raise the screen brightness on the other device',
  'transfer.remote.scanClose': 'Close',
  'transfer.remote.scanRetry': 'Retry',
  'transfer.remote.scanFailed': 'Cannot start the camera',
  'transfer.remote.scanPermission':
    'Camera permission denied; allow camera access for this app in system settings and retry',
  'transfer.remote.paste': 'Paste',
  'transfer.remote.pasteFailed': 'Clipboard unavailable; select and paste manually',
  'transfer.remote.errorMalformed': 'Invalid pairing link or JSON',
  'transfer.remote.errorIncomplete':
    'Pairing data is incomplete (nodeId and at least one address are required)',
  'transfer.remote.errorAddressInvalid': 'Address is not dialable (expects a /multiaddr)',

  // ==================== My device (T21, file-transfer standalone) ====================
  'transfer.myDevice.title': 'My device',
  'transfer.myDevice.loading': 'Reading this device…',
  'transfer.myDevice.loadFailed': 'Could not read this device. Try again.',
  'transfer.myDevice.unsupportedTitle': 'This host cannot generate a link yet',
  'transfer.myDevice.unsupportedBody':
    'The host must provide the local nodeId and dialable addresses (host-peer node-info) before a link can be shown. This version never fabricates one; you can still pre-save an external access address below.',
  'transfer.myDevice.deviceName': 'Device name',
  'transfer.myDevice.unnamed': 'Unnamed device',
  'transfer.myDevice.fingerprint': 'Fingerprint',
  'transfer.myDevice.relayState': 'External access',
  'transfer.myDevice.relayIdle': 'Off',
  'transfer.myDevice.relayConnecting': 'Connecting…',
  'transfer.myDevice.relayReserved': 'Ready',
  'transfer.myDevice.relayLost': 'Lost (retrying)',
  'transfer.myDevice.relayUnknown': 'Unknown',
  'transfer.myDevice.addresses': 'Dialable addresses',
  'transfer.myDevice.linkLabel': 'Link',
  'transfer.myDevice.autoDiscoveryHint':
    'With the same relay configured on both ends, devices appear automatically under “Nearby devices” — no QR code or link copying. The relay only handles discovery; the first connection still needs approval on the other device.',
  'transfer.myDevice.linkHint':
    'Only needed when the other device cannot join the same relay. Copy it into a chat, then paste it under “Add remote device” on the other device.',
  'transfer.myDevice.linkUnavailable':
    'No dialable address (need a LAN address or a ready relay address)',
  'transfer.myDevice.copy': 'Copy link',
  'transfer.myDevice.copied': 'Copied',
  'transfer.myDevice.copyFailed': 'Copy failed; select the text and copy manually',
  'transfer.myDevice.share': 'Share link',
  'transfer.myDevice.shared': 'Shared',
  'transfer.myDevice.shareFailed': 'Share failed; use Copy instead',
  'transfer.myDevice.relayRoomLabel': 'Space code (same on both ends)',
  'transfer.myDevice.relayRoomPlaceholder': 'Leave empty to see every device on this relay',
  'transfer.myDevice.relayRoomHint':
    'With a space code, only devices in the same space discover each other through the relay. The relay receives its hash, never the code.',
  'transfer.myDevice.relayRoomSaved': 'Space code saved',
  'transfer.myDevice.relayRoomError':
    'Save failed: use letters, digits, underscores or dashes (max 64).',
  'transfer.myDevice.relayRoomSave': 'Save space code',
  'transfer.myDevice.relayTitle': 'External access (relay)',
  'transfer.myDevice.relayHint':
    'Import the address once in the Network ingress center; all apps share it. Auto-discovery requires the same relay on both ends (optionally with the same space code). The relay only forwards and helps discovery; it is not an authorization point.',
  'transfer.myDevice.relayPlaceholder': '/ip4/203.0.113.9/tcp/4001/p2p/12D3KooW…',
  'transfer.myDevice.relayUnsupported':
    'This host version only saves the config; it does not establish a relay reservation yet. It will take effect after a host upgrade.',
  'transfer.myDevice.relaySaved': 'Saved',
  'transfer.myDevice.relayError': 'Save failed: invalid address or storage unavailable',
  'transfer.myDevice.relaySave': 'Save external access',
  'transfer.myDevice.refresh': 'Refresh',
  'transfer.myDevice.close': 'Done',
  'transfer.relayCard.conflict.title': 'Global relay differs from the invite',
  'transfer.relayCard.conflict.body':
    'Auto-discovery will not work. Switch Network to the invited relay, or ask the other side to use yours.',
  'transfer.relayCard.unconfigured.title': 'Cross-network not configured',
  'transfer.relayCard.unconfigured.body':
    'A relay is required. Paste an invite, or set up your own relay.',
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
    'This relay version does not handle rendezvous queries; upgrade it and retry.',
  'transfer.relayCard.denied.title': 'Relay rejected this device',
  'transfer.relayCard.denied.body':
    'Allowlist mode requires enrollment first; check the relay configuration.',
  'transfer.relayCard.error.title': 'Discovery query failed',
  'transfer.relayCard.error.body': '{detail}',
  'transfer.relayCard.unavailable.title': 'Relay not ready',
  'transfer.relayCard.unavailable.body':
    'It will retry once the relay reservation is ready; you can also refresh manually.',
  'transfer.relayCard.readyEmpty.title': 'Ready, no devices in this space yet',
  'transfer.relayCard.readyEmpty.body':
    'Make sure the other side has the app open and both use the same space code.',
  'transfer.relayCard.ready.title': '{count} devices online in this space',
  'transfer.relayCard.ready.body': 'Updated {seconds}s ago; send files directly from a device row.',
  'transfer.relayCard.pending.title': 'Checking discovery status',
  'transfer.relayCard.pending.body':
    'Refresh to query again; older hosts may not report discovery status.',
  'transfer.relayCard.roomHint': 'No space code: every device on this relay is visible.',
  'transfer.relayCard.stale': 'Status may be stale; refresh to retry.',
  'transfer.relayCard.actionPaste': 'Paste invite',
  'transfer.relayCard.actionInvite': 'Generate invite',
  'transfer.relayCard.actionRefresh': 'Refresh',
  'transfer.relayCard.actionCenter': 'Open Network',
  'transfer.relayCard.actionSettings': 'Open settings',
  'transfer.relayCard.openCenterUnavailable':
    'This host cannot navigate; open Network from the sidebar.',
  'transfer.invite.title': 'Invite a device',
  'transfer.invite.hint':
    'Bundle the relay and space code into one invite; the other side scans or pastes it once to discover you.',
  'transfer.invite.generate': 'Generate invite',
  'transfer.invite.generating': 'Generating…',
  'transfer.invite.generateFailed': 'Could not generate the invite. Try again.',
  'transfer.invite.errorRelayMissing':
    'No relay configured yet. Fill in the relay under My device, or paste an invite.',
  'transfer.invite.errorSaveFailed': 'Could not save the space code. Try again.',
  'transfer.invite.errorMalformed': 'This is not a valid invite (damaged payload)',
  'transfer.invite.errorMissingRoom': 'The invite has no space code',
  'transfer.invite.errorAddressInvalid': 'The relay address in the invite is not usable',
  'transfer.invite.copy': 'Copy invite',
  'transfer.invite.copied': 'Invite copied',
  'transfer.invite.copyFailed': 'Copy failed; select the text manually',
  'transfer.invite.share': 'Share invite',
  'transfer.invite.shared': 'Shared',
  'transfer.invite.shareFailed': 'Share failed; use Copy instead',
  'transfer.invite.rotate': 'Rotate space code',
  'transfer.invite.rotateHint':
    'Old invites can still enter the old space, but will no longer see this device. Send the new invite to the devices you want to connect.',
  'transfer.invite.inputHint':
    'Paste an invite or device link from the other side; an invite asks you to confirm the space first.',
  'transfer.invite.placeholder': 'wasmnest://join/… or wasmnest://pair/…',
  'transfer.invite.joinTitle': 'Join space',
  'transfer.invite.joinName': 'Join the space of “{name}”?',
  'transfer.invite.joinRelay': 'Relay',
  'transfer.invite.joinRoom': 'Space code',
  'transfer.invite.joinDevices': 'Devices in this space',
  'transfer.invite.joinLeaveRoom': 'You are in another space; joining will hide its devices.',
  'transfer.invite.openCenter': 'Open Network',
  'transfer.invite.openCenterUnavailable':
    'This host cannot navigate there; open the Network app manually.',
  'transfer.invite.join': 'Join',
  'transfer.invite.joining': 'Joining…',
  'transfer.invite.joinFailed': 'Save failed; you have not joined. Try again.',
  'transfer.invite.joined': 'Joined the space of “{name}”',
  'transfer.invite.unnamed': 'the other device',

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
  'transfer.v2.devices.rescan': 'Scan again',
  'transfer.v2.devices.groupConnected': 'Connected',
  'transfer.v2.devices.groupNearby': 'Nearby devices',
  'transfer.v2.devices.emptyTitle': 'No devices yet',
  'transfer.v2.pendingRequests': '{count} pending request(s)',
  'transfer.v2.history.openFolder': 'Open containing folder',
  'transfer.v2.history.noLocalFile': 'File not on this device',
  'transfer.history.allFilesAccess.title': 'All files access required',
  'transfer.history.allFilesAccess.message':
    'Opening the system Downloads folder requires the "All files access" permission (Settings → Apps → Special access → All files access). Some devices do not offer this switch; in that case WasmNest automatically shows a mirrored folder view of your downloads, no permission needed.',
  'transfer.history.allFilesAccess.cancel': 'Cancel',
  'transfer.history.allFilesAccess.goToSettings': 'Open settings',
  'transfer.history.allFilesAccess.after':
    'Enable "All files access" in system settings, then tap "Show in folder" again',
} satisfies MessageSchema
