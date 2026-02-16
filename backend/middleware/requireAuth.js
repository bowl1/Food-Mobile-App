const { verifyToken } = require('../firebaseAdmin');

async function requireAuth(req, res, next) {
  try {
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

    if (!token) {
      return res.status(401).json({ message: 'Missing token' });
    }

    const decodedUser = await verifyToken(token);
    if (!decodedUser) {
      return res.status(403).json({ message: 'Invalid token' });
    }

    req.user = decodedUser;
    return next();
  } catch (error) {
    console.error('Auth middleware failed:', error);
    return res.status(403).json({ message: 'Invalid token' });
  }
}

module.exports = { requireAuth };
