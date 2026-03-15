export function validateSignalingUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid signaling server URL: ${url}`);
  }

  // Only allow http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Signaling server must use http or https, got: ${parsed.protocol}`);
  }

  // Block private/internal IPs (basic check on hostname)
  const hostname = parsed.hostname;
  if (isPrivateHost(hostname)) {
    throw new Error(`Signaling server must not point to private/internal addresses: ${hostname}`);
  }

  // Return sanitized base URL (no path, no query, no fragment)
  return `${parsed.protocol}//${parsed.host}`;
}

function isPrivateHost(hostname: string): boolean {
  // Allow localhost explicitly for development
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return false; // Allow localhost for dev/testing
  }

  // Unwrap IPv6 bracket notation [::1] -> ::1
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  // Allow ::1 (IPv6 loopback) unwrapped
  if (unwrapped === '::1') {
    return false;
  }

  // Block internal ranges
  const parts = hostname.split('.').map(Number);
  if (parts.length === 4 && parts.every(n => !isNaN(n))) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
  }

  return false;
}
