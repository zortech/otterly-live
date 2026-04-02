'use strict';

const { Router } = require('express');
const eventCaptureManager = require('../event-capture/manager');
const logger = require('../lib/logger');

const router = Router();

// POST /api/event-capture/start — manually start capture for a service
router.post('/start', async (req, res) => {
  const { serviceId } = req.body;
  if (typeof serviceId !== 'number') {
    return res.status(400).json({ error: 'serviceId (number) required' });
  }
  try {
    await eventCaptureManager.start(serviceId);
    res.json({ ok: true, serviceId, status: eventCaptureManager.status()[serviceId]?.state ?? 'starting' });
  } catch (err) {
    logger.error('POST /api/event-capture/start error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/event-capture/stop — manually stop capture for a service
router.post('/stop', async (req, res) => {
  const { serviceId } = req.body;
  if (typeof serviceId !== 'number') {
    return res.status(400).json({ error: 'serviceId (number) required' });
  }
  try {
    await eventCaptureManager.stop(serviceId);
    res.json({ ok: true, serviceId });
  } catch (err) {
    logger.error('POST /api/event-capture/stop error', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/event-capture/status
router.get('/status', (req, res) => {
  res.json(eventCaptureManager.status());
});

module.exports = router;
