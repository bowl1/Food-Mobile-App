const express = require('express');
const { firestore } = require('../firebaseAdmin');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
const usersCollection = firestore.collection('users');
const MAX_AVATAR_BYTES = 1_000_000;

router.post('/upload', requireAuth, async (req, res) => {
  try {
    const { uid, avatar } = req.body;
    if (!uid || !avatar) {
      return res.status(400).json({ message: 'Missing parameters' });
    }
    if (typeof avatar !== 'string') {
      return res.status(400).json({ message: 'Avatar must be a base64 string' });
    }
    if (Buffer.byteLength(avatar, 'utf8') > MAX_AVATAR_BYTES) {
      return res.status(413).json({ message: 'Avatar payload too large' });
    }
    if (uid !== req.user.uid) {
      return res.status(403).json({ message: 'Forbidden uid access' });
    }

    await usersCollection.doc(uid).set(
      {
        uid,
        avatar,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );

    return res.status(200).json({ message: 'Avatar uploaded successfully' });
  } catch (error) {
    console.error('Failed to upload avatar:', error);
    return res.status(500).json({ message: 'Failed to upload avatar' });
  }
});

router.get('/:uid', requireAuth, async (req, res) => {
  try {
    const { uid } = req.params;
    if (uid !== req.user.uid) {
      return res.status(403).json({ message: 'Forbidden uid access' });
    }

    const userDoc = await usersCollection.doc(uid).get();

    if (!userDoc.exists || !userDoc.data().avatar) {
      return res.status(404).json({ message: 'Avatar not found' });
    }

    return res.json({ avatar: userDoc.data().avatar });
  } catch (error) {
    console.error('Failed to fetch avatar:', error);
    return res.status(500).json({ message: 'Failed to fetch avatar' });
  }
});

module.exports = router;
