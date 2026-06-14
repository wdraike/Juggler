const express = require('express');
const router = express.Router();
const weatherController = require('../controllers/weather.controller');

router.get('/geocode', weatherController.geocode);
router.get('/reverse-geocode', weatherController.reverseGeocode);
router.get('/', weatherController.getForecast);
router.post('/ingest', weatherController.ingest);

module.exports = router;
