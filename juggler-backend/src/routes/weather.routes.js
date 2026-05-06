const express = require('express');
const router = express.Router();
const weatherController = require('../controllers/weather.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');

router.use(authenticateJWT);

router.get('/geocode', weatherController.geocode);
router.get('/reverse-geocode', weatherController.reverseGeocode);
router.get('/', weatherController.getForecast);
router.post('/ingest', weatherController.ingest);

module.exports = router;
