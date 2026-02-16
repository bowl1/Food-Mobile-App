const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const favoriteRoutes = require('./routes/favorites');
const authRoutes = require('./routes/auth');
const avatarRoutes = require('./routes/avatar');
const recipeRoutes = require('./routes/recipes');

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.get('/', (req, res) => {
  res.send('Welcome to the Recipe API with Firestore and Firebase Auth!');
});

app.use('/api/auth', authRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/avatar', avatarRoutes);
app.use('/api/recipes', recipeRoutes);

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
