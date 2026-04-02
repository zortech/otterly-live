const EventEmitter = require('events');
const eventBus = new EventEmitter();
eventBus.setMaxListeners(50); // headroom for platform capture workers
module.exports = eventBus;
