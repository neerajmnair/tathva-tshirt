// QR portal configuration. Everything here is public by design:
// a Google OAuth *Client ID* is not a secret, and the QR carries only a roll number.
// NEVER put an OAuth client secret in this file.
window.TATHVA_QR_CONFIG = {
  // Google Cloud Console -> Credentials -> OAuth 2.0 Client ID (Web application).
  // Add the portal's origin to "Authorized JavaScript origins".
  googleClientId: '',

  // Only allow accounts from this domain to sign in (leave '' to allow any).
  allowedEmailDomain: 'nitc.ac.in',

  // How to derive a roll number from the signed-in email address.
  // The first capture group of the first matching pattern is used.
  // Example: aarav_b220123cs@nitc.ac.in -> B220123CS
  rollNoPatterns: [
    /_([bmp]\d{6}[a-z]{2})@/i,
    /^([bmp]\d{6}[a-z]{2})@/i,
    /^([a-z]{1,3}\d{2}[a-z]{2}\d{3})@/i,
  ],

  // Optional exact email -> roll number overrides, loaded from rollno-map.json
  // (a plain {"email": "ROLL"} object). Missing file is fine.
  rollNoMapUrl: 'rollno-map.json',

  // If the roll number cannot be derived, let the student type it (they still
  // have to be signed in). The distribution server is always the source of truth.
  allowManualEntry: true,

  // QR payload format: 'plain' -> B22CS001, 'versioned' -> TATHVA:B22CS001
  qrFormat: 'plain',
};
