'use strict';

const BaseCapture = require('./base-capture');
const logger = require('../lib/logger');

class XCapture extends BaseCapture {
  async connect() {
    logger.info(`[x-capture:${this.svc.id}] event capture is not supported for X (Twitter)`);
    const err = Object.assign(
      new Error('X (Twitter) does not support live event capture'),
      { code: 'NOT_SUPPORTED', permanent: true }
    );
    this.emit('error', err);
  }

  async disconnect() {
    // No connection to close
  }
}

module.exports = XCapture;
