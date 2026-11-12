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
  // T12: 中继 / 远程设备（连接串导入、传输形态、手动尝试外网）
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

  // ==================== Top bar ====================
  'transfer.topbar.sendToPhone': 'Send to current device…',
  'transfer.topbar.downloadSelected': 'Download selected ({count})',
  'transfer.topbar.refresh': 'Refresh',
  'transfer.topbar.settings': 'Settings',
  'transfer.topbar.closeSettings': 'Back',

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
  'transfer.settings.relayHint':
    'Allowing relay only adds relay candidates to dialing; encryption stays on either way',
  'transfer.settings.relayThreshold': 'Relay prompt threshold (MB)',
  'transfer.settings.relayThresholdHint':
    'Warn once before sending over relay when the batch is at least this large; 0 = warn every time',

  // ==================== Relay send hint ====================
  'transfer.relayHint.title': 'Sending over relay',
  'transfer.relayHint.body':
    'This connection goes through a relay, so large files may be slower. Encryption stays on. Continue?',
  'transfer.relayHint.confirm': 'Continue',
  'transfer.relayHint.cancel': 'Cancel',

  // ==================== Add remote device ====================
  'transfer.remote.title': 'Add remote device',
  'transfer.remote.hint':
    'Paste the pairing link (wasmnest://pair/…) or the raw JSON payload from the other device. Only a one-time ticket is carried; long-term keys never are.',
  'transfer.remote.placeholder': 'wasmnest://pair/… or {"nodeId":"…","addrs":["…"]}',
  'transfer.remote.sourceHint':
    'Preferred: configure the same relay on both ends under My device → External access. Devices on the same relay appear automatically — no QR code or link exchange. Use the link / QR below only when both sides cannot share a relay.',
  'transfer.remote.cancel': 'Cancel',
  'transfer.remote.confirm': 'Add',
  'transfer.remote.added': 'Remote device added',
  'transfer.remote.addedWithRelay': 'Added (relay candidate included, works across networks)',
  'transfer.remote.addedLanOnly': 'Added (LAN only)',
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
    'The host must provide the local nodeId and dialable addresses (host-peer node-info) before a link can be shown. This version never fabricates one; the relay address, if configured, is shown below.',
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
  'transfer.myDevice.qrHint':
    'Only needed when the other device cannot join the same relay. Scan it with this app’s “Scan”; the system camera will not open this app.',
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
  'transfer.myDevice.relayCenterEmpty':
    'No relay address has been imported in Network ingress yet.',
  'transfer.myDevice.relaySourceCache':
    'The Network ingress center is unavailable; showing the local cached address.',
  'transfer.myDevice.relayCenterError': 'Could not read the config center: {message}',
  'transfer.myDevice.relayOpenCenter': 'Open Network ingress',
  'transfer.myDevice.relayOpenUnavailable':
    'This host cannot navigate between apps; open Network ingress from the sidebar.',
  'transfer.myDevice.relayUnsupported':
    'This host version cannot establish a relay reservation yet; the config will take effect after a host upgrade.',
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
    'No relay configured yet. Configure one in Network, or paste the other side’s invite.',
  'transfer.invite.errorSaveFailed': 'Could not save the space code. Try again.',
  'transfer.invite.errorMalformed': 'This is not a valid invite (damaged payload)',
  'transfer.invite.errorMissingRoom': 'The invite has no space code',
  'transfer.invite.errorAddressInvalid': 'The relay address in the invite is not usable',
  'transfer.invite.copy': 'Copy invite',
  'transfer.invite.copied': 'Invite copied',
  'transfer.invite.copyFailed': 'Copy failed; select the text manually',
  'transfer.invite.rotate': 'Rotate space code',
  'transfer.invite.rotateHint':
    'Old invites can still enter the old space, but will no longer see this device. Send the new invite to the devices you want to connect.',
  'transfer.invite.qrHint':
    'Scan it from file-transfer on the other device (the system camera does not open this app)',
  'transfer.invite.inputHint':
    'Paste an invite or device link from the other side; an invite asks you to confirm the space first.',
  'transfer.invite.placeholder': 'wasmnest://join/… or wasmnest://pair/…',
  'transfer.invite.joinTitle': 'Join space',
  'transfer.invite.joinName': 'Join the space of “{name}”?',
  'transfer.invite.joinRelay': 'Relay',
  'transfer.invite.joinRoom': 'Space code',
  'transfer.invite.joinDevices': 'Devices in this space',
  'transfer.invite.joinLeaveRoom': 'You are in another space; joining will hide its devices.',
  'transfer.invite.joinConflict':
    'The global relay differs from the invite (the center wins). Auto-discovery will not work; switch Network to the invited relay, or ask the other side to use yours.',
  'transfer.invite.openCenter': 'Open Network',
  'transfer.invite.openCenterUnavailable':
    'This host cannot navigate there; open the Network app manually.',
  'transfer.invite.join': 'Join',
  'transfer.invite.joining': 'Joining…',
  'transfer.invite.joinFailed': 'Save failed; you have not joined. Try again.',
  'transfer.invite.joined': 'Joined the space of “{name}”',
  'transfer.invite.unnamed': 'the other device',

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
