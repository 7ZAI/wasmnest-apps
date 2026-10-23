/**
 * Auth Center English copy (flat dotted keys; namespace added by i18n/index.ts)
 *
 * Copy rules (issue #6 D3): distinguish "known not registered" from "unreadable";
 * unreadable must state the reason rather than fall back to an empty list; for
 * integrated apps, "not installed" and "state unreadable" never impersonate
 * each other.
 */
const en: Record<string, string> = {
  title: 'Auth Center',
  subtitle: 'The single arbiter for inbound connections on this machine: who is admitted, who is denied, and why.',
  'banner.loading': 'Reading the auth center placement status…',
  'banner.registered':
    'The auth center is registered: inbound connections are judged here, and the pairing code / QR below can be used to onboard devices.',
  'banner.not_ready':
    'The auth center is not registered: every inbound connection is denied (deny_kind = no_center). Check the reason and the registration failure log.',
  'banner.unknown':
    'The auth center status is unreadable: this is not the same as "not registered" — check the backend activation chain and host communication.',

  'status.title': 'Placement',
  'status.registered': 'Registered',
  'status.registered.hint': 'The center is registered; inbound connections are judged by its policy.',
  'status.not_ready': 'Known not registered',
  'status.not_ready.hint':
    'The center is not registered: every inbound connection is denied right now (deny_kind = no_center).',
  'status.unknown': 'Unreadable',
  'status.unknown.hint':
    'The command returned no readable state (backend not ready or the call failed) — do not treat this as "not registered".',
  'status.reason': 'Reason',
  'status.owner': 'Registered owner',
  'status.none': '—',
  'status.version': 'Plugin version',

  'methods.title': 'Auth methods',
  'methods.hint':
    'Methods this center declares. "Unavailable" means declared but not implemented yet — an empty list is never used to fake it.',
  'methods.pairing_code': 'Pairing code',
  'methods.qr': 'QR code',
  'methods.biometric': 'Biometric',
  'methods.jwt': 'Admission JWT',
  'methods.available': 'Available',
  'methods.unavailable': 'Unavailable',

  'pairing.title': 'Pairing code / QR',
  'pairing.hint':
    'The pairing code and QR token are the admission credentials for mobile devices: generating a new one replaces the old, a successful verify consumes it, and expiry hides it automatically.',
  'pairing.code.title': 'Pairing code',
  'pairing.qr.title': 'QR token',
  'pairing.generate': 'Generate',
  'pairing.clear': 'Clear',
  'pairing.remaining': '{seconds}s left (snapshot at fetch time; refresh to update)',

  'trust.title': 'Trusted devices',
  'trust.hint':
    'Unified view: paired devices (auth-records store) plus trusted peers (host peer trust store). Revoking a paired device soft-deletes it and drops its connection history.',
  'trust.count': '{count} entries',
  'trust.empty': 'No trusted devices',
  'trust.revoke': 'Revoke',
  'trust.addedAt': 'added {at}',
  'trust.peerError': 'Trusted-peer segment unavailable (paired-device segment still works): {message}',
  'trust.kind.pairing': 'paired',
  'trust.kind.peer': 'peer',

  'history.title': 'Connection history',
  'history.hint':
    'Connection events per device: method and result come straight from the record store; clearing only drops history, never the pairing.',
  'history.device': 'Device',
  'history.deviceMeta': 'paired {at} · {count} connections',
  'history.clear': 'Clear history',
  'history.noDevices': 'No paired devices yet (this is an empty set, not a read failure)',
  'history.noEvents': 'No connection records for this device',
  'history.at': '{at}',
  'history.method.pairing_code': 'Pairing code',
  'history.method.qr': 'QR code',
  'history.method.biometric': 'Biometric',
  'history.method.jwt': 'Admission JWT',
  'history.result.success': 'success',
  'history.result.failed': 'failed',

  'keys.title': 'Admission key generation',
  'keys.hint':
    'Generation ids only — never key material. Rotation replaces the signing key: the previous generation keeps verifying during the grace window, and existing tokens are not revoked.',
  'keys.active': 'Active signing generation',
  'keys.previous': 'Previous (grace window)',
  'keys.none': 'none',
  'keys.rotate': 'Rotate key',
  'keys.rotated': 'Rotated to {kid} (previous generation kept until the grace window ends)',

  'consumers.title': 'Integrated apps',
  'consumers.hint':
    'These apps no longer keep auth copies of their own: device pairing, trusted devices, connection history and first-connection consent are all judged here through interop calls. The state on the right comes from the host plugin list; when this center is not registered they fail closed too.',
  'consumers.count': '{count} consumers',
  'consumers.state.activated': 'Active',
  'consumers.state.loaded': 'Loaded (not active)',
  'consumers.state.activating': 'Activating',
  'consumers.state.degraded': 'Degraded',
  'consumers.state.needsApproval': 'Needs approval',
  'consumers.state.error': 'Activation failed',
  'consumers.state.deactivated': 'Deactivated',
  'consumers.state.missing': 'Not installed',
  'consumers.state.unknown': 'State unreadable',
  'consumers.surface.device-center': 'Device center (pairing code / QR)',
  'consumers.surface.trust': 'Trusted devices',
  'consumers.surface.history': 'Connection history',
  'consumers.surface.keys': 'Key rotation',
  'consumers.surface.consent': 'First-connection consent',

  'preview.hint': 'Open for details',

  'error.title': 'Read failed',
  'error.body': 'Cannot read: {message}',
  retry: 'Retry',
  loading: 'Reading…',
  refresh: 'Refresh',
}

export default en
