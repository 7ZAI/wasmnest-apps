import type { MessageSchema } from './messages'

/** Network Config (English; keys mirror `MessageSchema`) */
const en: MessageSchema = {
  title: 'Network',
  subtitle:
    'Import your self-hosted relay once here and every cross-network app reuses it; this page also manages which apps may expose over WAN.',
  loading: 'Loading…',
  refresh: 'Refresh',
  'error.body': 'Failed to read: {message}',

  'relay.state.configured': '{count} address(es) configured',
  'relay.state.empty': 'No relay address imported yet',
  'relay.current.title': 'Current relay configuration',
  'relay.current.addrs': 'Dialable addresses',
  'relay.current.peerId': 'PeerId',
  'relay.current.fingerprint': 'Fingerprint',
  'relay.current.verified': 'Verified locally',
  'relay.current.access': 'Access mode',
  'relay.current.accessOpen': 'Open',
  'relay.current.accessAllowlist': 'Allowlist',
  'relay.current.accessUnknown': 'Not provided',
  'relay.current.quota': 'Per-circuit limit',
  'relay.current.quotaValue': '{bytes} bytes / {secs} s',
  'relay.current.quotaUnknown': 'Not provided',
  'relay.current.version': 'Relay version',
  'relay.current.importedAt': 'Imported at',
  'relay.current.source': 'Source',
  'relay.current.sourceJson': 'print-addrs JSON',
  'relay.current.sourceText': 'print-addrs text',
  'relay.import.clear': 'Remove',
  'relay.import.cleared': 'Relay address removed',
  'relay.import.clearFailed': 'Remove failed: please retry',
  'relay.import.loadFailed':
    'The stored relay configuration cannot be parsed (old version or manual edit). It was not cleared automatically; import again or remove it explicitly.',

  'relay.deploy.title': 'Generate deploy commands',
  'relay.deploy.desc':
    'Pick a deployment mode and run the commands on your Linux server; the first run must init the identity (losing it changes the PeerId and every client has to re-import).',
  'relay.deploy.advertise': 'Public host / IP',
  'relay.deploy.advertisePlaceholder': 'relay.example.com',
  'relay.deploy.port': 'Public port',
  'relay.deploy.version': 'Image version',
  'relay.deploy.mode.compose': 'Docker Compose',
  'relay.deploy.mode.docker': 'Docker run',
  'relay.deploy.mode.systemd': 'systemd',
  'relay.deploy.emptyHint':
    'Enter the public host / IP to generate deploy commands (only domain names or IP literals).',
  'relay.deploy.copy': 'Copy commands',
  'relay.deploy.copied': 'Deploy commands copied',
  'relay.deploy.copyFailed': 'Copy failed: select the generated text manually',
  'relay.deploy.download': 'Download compose',
  'relay.deploy.downloadFailed': 'Download is unavailable here: copy the text and save it manually',
  'relay.deploy.imageHint':
    'Image comes from {repo}; pin it by digest for production deployments.',
  'relay.deploy.noCreds':
    'The output contains no enrollment token or server credentials; create tokens server-side with wasmnest-relay token create and deliver them out of band.',
  'relay.deploy.invalidAdvertise':
    'Invalid public host / IP: only domain names or IP literals, without paths or spaces',
  'relay.deploy.invalidPort': 'Invalid port: must be an integer between 1 and 65535',
  'relay.deploy.invalidTag':
    'Invalid image version: only Docker tag characters (letters / digits / _ . -)',

  'relay.import.title': 'Import relay addresses',
  'relay.import.desc':
    'Paste wasmnest-relay print-addrs --json, the plain-text print-addrs output (one address per line plus peerId metadata), or a list of addresses. A QR code carries the same JSON: paste its text here.',
  'relay.import.placeholder':
    'Paste print-addrs --json output, or one multiaddr per line (e.g. /dns4/relay.example.com/tcp/4001/p2p/12D3KooW…)',
  'relay.import.submit': 'Import and save',
  'relay.import.success': 'Relay address saved',
  'relay.import.saveFailed':
    'Address parsed, but saving failed: check host storage permission and retry',

  'relay.error.empty': 'Nothing to import: paste print-addrs JSON or address text',
  'relay.error.json': 'JSON parse failed: make sure the full print-addrs --json output is pasted',
  'relay.error.version': 'Unsupported import payload version: this app only accepts v1',
  'relay.error.kind': 'Wrong payload kind: not a wasmnest-relay import payload',
  'relay.error.peerId': 'PeerId is not a valid ed25519 libp2p PeerId',
  'relay.error.fingerprintMissing':
    'Payload has no peer_id_sha256 fingerprint; the relay identity cannot be verified',
  'relay.error.fingerprintMismatch':
    'Fingerprint does not match the locally recomputed value: the payload may be tampered with or from another version',
  'relay.error.controlProtocol':
    'Control protocol mismatch: this app requires /wasmnest/relay-control/1',
  'relay.error.addrs': 'Address list is empty or exceeds the limit',
  'relay.error.addrShape':
    'Invalid address: only /ip4|ip6|dns/tcp/<port>/p2p/<PeerId> relay base addresses are accepted (/p2p-circuit addresses are dial targets, not relay addresses)',
  'relay.error.addrPeer': 'The PeerId inside the address does not match the payload peer_id',
  'relay.error.multiPeer':
    'Addresses point at different relay PeerIds: import one relay at a time',
  'relay.error.metadata': 'A metadata line appears twice with different values',
  'relay.error.access': 'Invalid access mode: only open / allowlist',
  'relay.error.quota':
    'Invalid quota fields: max_circuit_bytes / max_circuit_duration_secs must be non-negative integers',
  'relay.error.line': 'Unrecognized line: not a relay address or known metadata',
  'relay.error.crypto': 'WebCrypto is unavailable here; the PeerId fingerprint cannot be recomputed',

  'relay.probe.title': 'Connectivity check',
  'relay.probe.desc':
    'Dials the relay with the local peer engine and shows the PeerId fingerprint plus RTT; failures point at port / firewall / DNS / version causes.',
  'relay.probe.action': 'Check connectivity',
  'relay.probe.empty': 'Import a relay address before checking.',
  'relay.probe.unsupported':
    'This host does not expose relay dialing yet (requires platform T06). Use the server-side self-check below for now.',
  'relay.probe.publicHint':
    'Public reachability must be tested from another network; doctor reports it as unknown instead of claiming local success means public availability.',

  'wan.title': 'App WAN registry',
  'wan.desc':
    'Decide per app whether it may hold a relay reservation; turning it off stops new reservations immediately and leaves the LAN entry untouched. Shared addresses do not imply WAN access.',
  'wan.empty': 'No app registered yet; apps appear here when they first integrate.',
  'wan.id': 'Plugin id',
  'wan.allow': 'Allow WAN',
  'wan.block': 'Block WAN',
  'wan.state.allowed': 'Allowed',
  'wan.state.blocked': 'Blocked',
  'wan.updatedAt': 'Last updated',
  'wan.note': 'Note',
  'wan.saveFailed': 'Policy switched, but writing storage failed: refresh to confirm the state',
  'wan.toggleFailed': 'Failed to switch policy: please retry',
  'wan.unknown': 'Unknown',
  'wan.loadFailed':
    'Failed to read the app registry; nothing was cleared automatically. Retry or check storage.',

  'preview.title': 'Network',
  'preview.configured': '{count} relay address(es)',
  'preview.empty': 'No relay address imported yet',
  'preview.unavailable': 'Configuration unavailable',
}

export default en
