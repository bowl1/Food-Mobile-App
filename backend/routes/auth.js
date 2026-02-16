const express = require('express');
const { firestore } = require('../firebaseAdmin');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
const usersCollection = firestore.collection('users');

router.post('/register', requireAuth, async (req, res) => {
  try {
    const userRef = usersCollection.doc(req.user.uid);
    const existing = await userRef.get();
    if (existing.exists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const newUser = {
      uid: req.user.uid,
      email: req.user.email,
      username: req.body.username,
      avatar: '',
      createdAt: new Date().toISOString(),
    };

    await userRef.set(newUser);
    return res.status(201).json({ message: 'User stored in Firestore', user: newUser });
  } catch (error) {
    console.error('Failed to store user:', error);
    return res.status(500).json({ message: 'Failed to store user', error: error.message });
  }
});

router.get('/user/:uid', requireAuth, async (req, res) => {
  try {
    const { uid } = req.params;
    if (uid !== req.user.uid) {
      return res.status(403).json({ message: 'Forbidden uid access' });
    }

    const userDoc = await usersCollection.doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userDoc.data();
    return res.json({ username: user.username, avatar: user.avatar || '' });
  } catch (error) {
    console.error('Failed to fetch user profile:', error);
    return res.status(500).json({ message: 'Failed to fetch user profile' });
  }
});

module.exports = router;
