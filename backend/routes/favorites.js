const express = require('express');
const { firestore } = require('../firebaseAdmin');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
const favoritesCollection = firestore.collection('favorites');

function favoriteDocId(uid, recipeId) {
  return `${uid}_${recipeId}`;
}

router.post('/', requireAuth, async (req, res) => {
  try {
    const recipeId = req.body.id;
    if (!recipeId) return res.status(400).json({ message: 'Missing recipe id' });

    const docRef = favoritesCollection.doc(favoriteDocId(req.user.uid, recipeId));
    const existing = await docRef.get();
    if (existing.exists) {
      return res.status(400).json({ message: 'Recipe already in favorites' });
    }

    const favorite = {
      ...req.body,
      uid: req.user.uid,
      createdAt: new Date().toISOString(),
    };

    await docRef.set(favorite);
    return res.status(201).json({ message: 'Recipe added to favorites' });
  } catch (error) {
    console.error('Failed to add favorite:', error);
    return res.status(500).json({ message: 'Failed to add favorite' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const snapshot = await favoritesCollection.where('uid', '==', req.user.uid).get();
    const favorites = snapshot.docs.map((doc) => doc.data());

    return res.json(favorites);
  } catch (error) {
    console.error('Failed to fetch favorites:', error);
    return res.status(500).json({ message: 'Failed to fetch favorites' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await favoritesCollection.doc(favoriteDocId(req.user.uid, id)).delete();

    return res.json({ message: 'Recipe removed from favorites' });
  } catch (error) {
    console.error('Failed to remove favorite:', error);
    return res.status(500).json({ message: 'Failed to remove favorite' });
  }
});

module.exports = router;
