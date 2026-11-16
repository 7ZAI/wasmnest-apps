import type { MessageSchema } from './messages'

/**
 * English translations
 *
 * Kept in a separate file so the two locales stay in sync at compile time.
 */
const en: MessageSchema = {
  // ==================== Sidebar ====================
  'transfer.sidebar.title': 'File Transfer',

  // ==================== Peer pill ====================
  'transfer.peer.online': 'Connected',
  'transfer.peer.offline': 'Not connected',
  'transfer.peer.notSharing': 'Connected · peer not sharing',
  'transfer.peer.unpaired': 'No device connected',
  'transfer.peer.noSharedRoots': "Peer hasn't shared any folders yet",
  'transfer.peer.unknown': 'Unknown device',
  'transfer.peer.switchTitle': 'Nearby devices (initiate connection)',

  // ==================== Nearby devices panel ====================
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
  'transfer.devices.discoverHint': 'Re-run LAN discovery and relay discovery together',
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
  // T12: relay / remote devices (transport shape, manual WAN attempt)
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

  // ==================== Top bar ====================
  'transfer.topbar.sendToPhone': 'Send to current device…',
  'transfer.topbar.downloadSelected': 'Download selected ({count})',
  'transfer.topbar.refresh': 'Refresh',
  'transfer.topbar.settings': 'Settings',
  'transfer.topbar.closeSettings': 'Back',

  // ==================== My device (settings: name / fingerprint) ====================
  'transfer.myDevice.title': 'My device',
  'transfer.myDevice.loading': 'Reading device info…',
  'transfer.myDevice.loadFailed': 'Failed to read device info, please retry',
  'transfer.myDevice.refresh': 'Retry',
  'transfer.myDevice.unsupportedTitle': 'Host not supported',
  'transfer.myDevice.unsupportedBody':
    'This host does not expose device identity; upgrade the host and retry.',
  'transfer.myDevice.deviceName': 'Device name',
  'transfer.myDevice.unnamed': 'Unnamed device',
  'transfer.myDevice.fingerprint': 'Fingerprint',
  'transfer.myDevice.hint':
    'The other device identifies this one by name and fingerprint in its nearby-device list.',

  // ==================== File table ====================
  'transfer.table.name': 'Name',
  'transfer.table.size': 'Size',
  'transfer.table.modified': 'Modified',
  'transfer.table.empty': 'This folder is empty',
  'transfer.table.loading': 'Loading...',
  'transfer.breadcrumb.home': 'Files',

  // ==================== Task states ====================
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
  'transfer.task.openDir': 'Open local folder',
  'transfer.task.retry': 'Retry',
  'transfer.task.resumeAll': 'Resume all',
  'transfer.task.download': 'Download',
  'transfer.task.upload': 'Upload',
  'transfer.task.empty': 'No tasks',
  'transfer.task.receivingEmpty': 'Nothing being received',
  'transfer.task.waitingApproval': 'Waiting for approval',
  'transfer.task.receiving': 'Receiving',

  // ==================== Intent-driven (v2.1) ====================
  'transfer.task.waitingReply': 'Waiting for reply',
  'transfer.task.peerOffline': 'Peer offline, task paused',

  // ==================== Queue panel ====================
  'transfer.queue.title': 'Transfer queue',
  'transfer.queue.count': '{count} tasks',
  'transfer.queue.close': 'Hide transfer queue',

  // ==================== Queue tabs (v2) ====================
  'transfer.queue.all': 'All',
  'transfer.queue.sending': 'Sending',
  'transfer.queue.receiving': 'Receiving',
  'transfer.queue.history': 'History',

  // ==================== Batch request (v2) ====================
  'transfer.request.title': 'File transfer request',
  'transfer.request.body': '{name} wants to send you {count} files ({size} total)',
  'transfer.request.countdown': 'Auto-reject in {seconds}s',
  'transfer.request.acceptAll': 'Accept all',
  'transfer.request.rejectAll': 'Reject all',
  'transfer.toast.receiving': '{name} is sending you {count} files',

  // ==================== First-connect consent (spec decision 6) ====================
  'transfer.consent.title': 'Connection request',
  'transfer.consent.body': '{name} wants to connect for file transfer',
  'transfer.consent.namelessHint':
    'Device name unavailable — verify the fingerprint below before deciding',
  'transfer.consent.fingerprintLabel': 'Device fingerprint',
  'transfer.consent.copy': 'Copy fingerprint',
  'transfer.consent.copied': 'Copied',
  'transfer.consent.copyHint': 'Copy the full fingerprint to compare on another device',
  'transfer.consent.countdown': 'Auto-reject in {seconds}s',
  'transfer.consent.accept': 'Accept and trust',
  'transfer.consent.trustHint':
    'Accepting adds this device to the trust list; future connections will not ask again.',
  'transfer.consent.deny': 'Reject',
  'transfer.consent.close': 'Close (same as reject)',

  // ==================== Trusted peers (spec decision 8) ====================
  'transfer.trusted.title': 'Trusted peers',
  'transfer.trusted.loading': 'Loading...',
  'transfer.trusted.empty':
    'No trusted peers yet; trust is established after the other side approves your first connection',
  'transfer.trusted.loadFailed': 'Failed to load trusted peers',
  'transfer.trusted.retry': 'Retry',
  'transfer.trusted.addedAt': 'Added: {time}',
  'transfer.trusted.revoke': 'Revoke',
  'transfer.trusted.cancel': 'Cancel',
  'transfer.trusted.revokeTitle': 'Revoke trust',
  'transfer.trusted.revokeBody':
    'After revoking, {name} will need your approval again on the next connection. Revoke trust for this device?',
  'transfer.trusted.revokeFailed': 'Revoke failed; please try again later',

  // ==================== Queue summary ====================
  'transfer.summary.active': '{count} active',
  'transfer.summary.queued': '{count} queued',
  'transfer.summary.failed': '{count} failed',
  'transfer.summary.rejected': '{count} rejected',
  'transfer.summary.speed': '{speed}/s total',

  // ==================== Settings ====================
  'transfer.settings.sharedRoots': 'Shared folders',
  'transfer.settings.addRoot': 'Add folder',
  'transfer.settings.removeRoot': 'Remove',
  'transfer.settings.noRoots': 'No shared folders yet',
  'transfer.settings.downloadDir': 'Download folder',
  'transfer.settings.noDownloadDir': 'Not set',
  'transfer.settings.chooseDir': 'Choose folder',
  'transfer.settings.concurrency': 'Concurrency',
  'transfer.settings.concurrencyHint':
    'Number of simultaneous transfers; increasing it may use more bandwidth',
  'transfer.settings.concurrencyMinus': 'Decrease concurrency',
  'transfer.settings.concurrencyPlus': 'Increase concurrency',
  'transfer.settings.encryptionNotice':
    'Transfers are always end-to-end encrypted (AES-256-GCM). Older peers without encryption support fail visibly instead of falling back to plaintext.',
  'transfer.settings.receivingPolicy': 'Receiving policy',
  'transfer.settings.receivingPolicyAsk': 'Ask every time',
  'transfer.settings.receivingPolicyAccept': 'Accept automatically',
  'transfer.settings.receivingPolicyReject': 'Reject automatically',
  'transfer.settings.receivingPolicyHint': 'Whether to ask before receiving files from peers',
  'transfer.settings.approvalTimeout': 'Approval timeout (s)',
  'transfer.settings.encryption': 'Transfer encryption',
  'transfer.settings.encryptionAlwaysOn': 'Always encrypted',
  'transfer.settings.encryptionHint':
    'Every transfer (LAN or relay) is encrypted and cannot be turned off; the peer must support encryption',
  // T12: 中继开关与提示阈值（关的是中继，不是加密）
  'transfer.settings.relay': 'Relay (WAN)',
  'transfer.settings.relayOn': 'Allow',
  'transfer.settings.relayOff': 'LAN only',
  'transfer.settings.relayThreshold': 'Relay prompt threshold (MB)',
  'transfer.settings.relayThresholdHint':
    'Warn once before sending over relay when the batch is at least this large; 0 = warn every time',

  // ==================== Relay send hint ====================
  'transfer.relayHint.title': 'Sending over relay',
  'transfer.relayHint.body':
    'This connection goes through a relay, so large files may be slower. Encryption stays on. Continue?',
  'transfer.relayHint.confirm': 'Continue',
  'transfer.relayHint.cancel': 'Cancel',

  // ==================== Relay config (settings, read-only + share) ====================
  'transfer.relayConfig.title': 'Relay configuration',
  'transfer.relayConfig.loading': 'Loading relay configuration…',
  'transfer.relayConfig.loadFailed': 'Failed to load relay configuration, please retry',
  'transfer.relayConfig.refresh': 'Reload',
  'transfer.relayConfig.empty':
    'No relay yet: import one in the network center, or scan a share QR generated on another device.',
  'transfer.relayConfig.source': 'Source',
  'transfer.relayConfig.sourceCenter': 'Network center',
  'transfer.relayConfig.sourceCache': 'Local cache (center unavailable)',
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
  'transfer.relayConfig.wanPolicy': 'Relay policy',
  'transfer.relayConfig.wanAllowed': 'Allowed',
  'transfer.relayConfig.wanBlocked': 'LAN only (relay off)',
  'transfer.relayConfig.room': 'Room code',
  'transfer.relayConfig.syncedAt': 'Fetched at',
  'transfer.relayConfig.copy': 'Copy',
  'transfer.relayConfig.copied': 'Copied',
  'transfer.relayConfig.copyFailed': 'Copy failed',
  'transfer.relayConfig.showAddr': 'Show address',
  'transfer.relayConfig.hideAddr': 'Hide address',
  'transfer.relayConfig.centerError': 'Network center unavailable; using local cache: {message}',
  'transfer.relayConfig.openCenter': 'Open network center',
  'transfer.relayConfig.openCenterUnavailable':
    'This host cannot navigate between apps; open the network center from the sidebar.',
  'transfer.relayConfig.share': 'Generate share QR',
  'transfer.relayConfig.shareRelayMissing': 'No relay address to share yet',
  'transfer.relayConfig.shareHint':
    'Scan this QR with File Transfer → Settings → Relay configuration → Scan on your phone.',
  'transfer.relayConfig.shareFailed': 'Failed to generate the share QR, please retry',

  // ==================== Errors (spec §10 + v2 reject reasons) ====================
  'transfer.error.duplicateName':
    'Upload failed: a file with the same name already exists in the target folder',
  'transfer.error.remoteChanged':
    "The remote file has changed and can't be resumed. Please start over.",
  'transfer.error.dirUnavailable': 'This folder is currently unavailable',
  'transfer.error.rejectedByUser': 'The transfer was rejected by the peer',
  'transfer.error.noResponse': 'No response from the peer; the request timed out',
  'transfer.error.policyDenied': 'The peer is set to reject incoming transfers',
  // ADR 0030 business error code (guest bail_with_code!)
  'transfer.error.queueFull': 'Send queue is full; try again later',
  // send-failure fallback (resolvePluginErrorText fallbackKey)
  'transfer.error.sendFailed': 'Send failed; try again',

  // ==================== Transfer history (v2) ====================
  'transfer.history.title': 'History',
  'transfer.history.clear': 'Clear history',
  'transfer.history.clearConfirmTitle': 'Clear transfer history?',
  'transfer.history.clearConfirmBody':
    'All completed, failed and cancelled records will be deleted (in-progress tasks are unaffected). This cannot be undone.',
  'transfer.history.empty': 'No transfer history',
  'transfer.history.openFolder': 'Show in folder',
  'transfer.history.results.completed': 'Completed',
  'transfer.history.results.failed': 'Failed',
  'transfer.history.results.rejected': 'Rejected',
  'transfer.history.results.cancelled': 'Cancelled',

  // ==================== Empty states ====================
  'transfer.empty.noRoots': 'Configure shared folders in Settings first',
  'transfer.empty.noRootsHint':
    'Add a local folder as a shared root so your peer can browse and download files from it',
  'transfer.empty.noPeer': 'No paired device detected',
  'transfer.empty.noPeerHint':
    'Make sure your phone and computer are on the same network and the phone is paired with sharing enabled',
  'transfer.empty.noDownloadDir': 'Configure a download folder in Settings first',
  'transfer.empty.noDownloadDirHint':
    'Choose where received files are saved, then you can download files from your peer to this device',

  // ==================== ETA ====================
  'transfer.eta.seconds': '{count}s left',
  'transfer.eta.minutes': '{count}m {seconds}s left',
  'transfer.eta.hours': '{count}h {minutes}m left',

  // ==================== Multitask card preview (mountPreview · 2026-10-20) ====================
  'transfer.preview.peersTitle': 'Peers',
  'transfer.preview.noPeers': 'No peers',
  'transfer.preview.morePeers': '{count} more peers',
  'transfer.preview.tasksTitle': 'Current transfers',
  'transfer.preview.moreTasks': '{count} more transfers',

  // ==================== Global notifications (wording taken verbatim from host `common.notification.*`) ====================
  'transfer.notification.peerConnected': '"{name}" connected',
  'transfer.notification.peerDisconnected': '"{name}" disconnected',
}

export default en
