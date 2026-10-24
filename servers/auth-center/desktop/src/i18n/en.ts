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
  'status.title': 'Placement',
  'status.registered': 'Registered',
  'status.not_ready': 'Known not registered',
  'status.unknown': 'Unreadable',
  'status.reason': 'Reason',
  'status.owner': 'Registered owner',
  'status.none': '—',
  'status.version': 'Plugin version',

  'methods.title': 'Auth methods',
  'methods.pairing_code': 'Pairing code',
  'methods.qr': 'QR code',
  'methods.biometric': 'Biometric',
  'methods.jwt': 'Admission JWT',
  'methods.available': 'Available',
  'methods.unavailable': 'Unavailable',

  'keys.title': 'Admission key generation',
  'keys.active': 'Active signing generation',
  'keys.previous': 'Previous',
  'keys.none': 'none',
  'keys.rotate': 'Rotate key',
  'keys.rotated': 'Rotated to {kid}',

  'consumers.title': 'Integrated apps',
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

  'error.title': 'Read failed',
  'error.body': 'Cannot read: {message}',
  retry: 'Retry',
  loading: 'Reading…',
  refresh: 'Refresh',
}

export default en
