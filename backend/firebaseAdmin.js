const admin = require('firebase-admin');

function loadServiceAccount() {
  const envValue = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (envValue) {
    try {
      const jsonString = envValue.trim().startsWith('{')
        ? envValue
        : Buffer.from(envValue, 'base64').toString('utf8');
      return JSON.parse(jsonString);
    } catch (err) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT:', err);
    }
  }

  const requiredKeys = [
    'FIREBASE_TYPE',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY_ID',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_CLIENT_ID',
    'FIREBASE_AUTH_URI',
    'FIREBASE_TOKEN_URI',
    'FIREBASE_AUTH_PROVIDER_X509_CERT_URL',
    'FIREBASE_CLIENT_X509_CERT_URL',
    'FIREBASE_UNIVERSE_DOMAIN',
  ];

  const hasAllKeys = requiredKeys.every((key) => Boolean(process.env[key]));
  if (hasAllKeys) {
    return {
      type: process.env.FIREBASE_TYPE,
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
      universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
    };
  }

  throw new Error(
    'Firebase service account not configured. Set FIREBASE_SERVICE_ACCOUNT (JSON/base64) or individual FIREBASE_* vars.',
  );
}

const serviceAccount = loadServiceAccount();

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const firestore = admin.firestore();

async function verifyToken(token) {
  try {
    return await admin.auth().verifyIdToken(token);
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

module.exports = { verifyToken, firestore };
